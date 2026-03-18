import fs from 'fs/promises';
import path from 'path';
import { watch } from 'chokidar';
import { SyncState } from './sync-state.js';
import { ClaudeCodeAdapter } from './adapters/claude-code.js';
import { CodexAdapter } from './adapters/codex.js';

const ADAPTER_TYPES = {
  'claude-code': ClaudeCodeAdapter,
  'codex': CodexAdapter,
};

/**
 * Core memory bridge engine.
 * Watches adapter directories and syncs memories bidirectionally.
 */
export class MemoryBridge {
  constructor(config) {
    this.config = config;
    this.adapters = new Map();
    this.state = new SyncState();
    this.watchers = [];
    this._debounceTimers = new Map();
  }

  /** Register all adapters from config */
  init() {
    for (const [name, adapterConfig] of Object.entries(this.config.adapters)) {
      const AdapterClass = ADAPTER_TYPES[adapterConfig.type];
      if (!AdapterClass) {
        console.error(`Unknown adapter type: ${adapterConfig.type}`);
        continue;
      }
      const resolvedConfig = {
        ...adapterConfig,
        memoryDir: adapterConfig.memoryDir.replace(/^~/, process.env.HOME),
      };
      this.adapters.set(name, new AdapterClass(resolvedConfig));
    }
    console.log(`Loaded ${this.adapters.size} adapters: ${[...this.adapters.keys()].join(', ')}`);
  }

  /** Run a one-time sync across all adapters */
  async sync() {
    await this.state.load();

    for (const [sourceName, sourceAdapter] of this.adapters) {
      const dir = sourceAdapter.getWatchDir();
      const ignorePatterns = sourceAdapter.getIgnorePatterns();

      let files;
      try {
        files = await fs.readdir(dir);
      } catch {
        console.log(`  ${sourceName}: directory not found (${dir}), skipping`);
        continue;
      }

      const mdFiles = files.filter(f =>
        f.endsWith('.md') && !ignorePatterns.includes(f)
      );

      console.log(`  ${sourceName}: found ${mdFiles.length} memories in ${dir}`);

      for (const filename of mdFiles) {
        await this.syncFile(sourceName, filename);
      }
    }

    await this.state.save();
    console.log('Sync complete.');
  }

  /** Sync a single file from source adapter to all other adapters */
  async syncFile(sourceName, filename) {
    const sourceAdapter = this.adapters.get(sourceName);
    const filePath = path.join(sourceAdapter.getWatchDir(), filename);

    let content;
    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch {
      return; // File disappeared
    }

    // Parse the memory
    const memory = sourceAdapter.parseMemory(filename, content);

    // If this memory originated from a bridge sync, don't re-sync it back
    // (it would bounce forever). But DO sync it to OTHER adapters it hasn't reached.
    const originalSource = memory.source;

    // Find or create bridge ID
    let bridgeId = memory.bridgeId;
    let existing = bridgeId ? this.state.get(bridgeId) : this.state.findByFile(sourceName, filename);

    if (existing && !bridgeId) {
      bridgeId = existing.id;
    }

    if (!bridgeId) {
      bridgeId = this.state.generateId();
    }

    const contentHash = this.state.hash(content);

    // Check if content has changed since last sync
    if (existing && existing.hash === contentHash) {
      return; // No changes
    }

    // Sync to all other adapters
    for (const [targetName, targetAdapter] of this.adapters) {
      if (targetName === sourceName) continue;

      // Don't sync back to the adapter that originally created this memory
      if (originalSource === targetName && !this.config.syncBackToOrigin) continue;

      const formatted = targetAdapter.formatMemory({
        ...memory,
        sourceAdapter: sourceName,
        bridgeId,
      });

      const targetPath = path.join(targetAdapter.getWatchDir(), formatted.filename);

      // Ensure target directory exists
      await fs.mkdir(targetAdapter.getWatchDir(), { recursive: true });

      // Check if target file already exists with same content
      try {
        const existingContent = await fs.readFile(targetPath, 'utf-8');
        if (this.state.hash(existingContent) === this.state.hash(formatted.content)) {
          continue; // Already up to date
        }
      } catch {
        // File doesn't exist yet, will create
      }

      this.state.startWrite(targetName);
      try {
        await fs.writeFile(targetPath, formatted.content, 'utf-8');
        await targetAdapter.afterWrite({ ...memory, sourceAdapter: sourceName }, formatted.filename);
        console.log(`  ${sourceName}/${filename} → ${targetName}/${formatted.filename}`);
      } finally {
        // Delay clearing the write flag to let the watcher debounce settle
        setTimeout(() => this.state.endWrite(targetName), 500);
      }

      // Update state mapping
      this.state.set(bridgeId, {
        name: memory.name,
        hash: contentHash,
        files: {
          ...(existing?.files || {}),
          [sourceName]: filename,
          [targetName]: formatted.filename,
        },
      });
    }

    await this.state.save();
  }

  /** Handle a file deletion */
  async handleDelete(sourceName, filename) {
    const existing = this.state.findByFile(sourceName, filename);
    if (!existing) return;

    if (this.config.syncDeletes) {
      for (const [adapterName, adapterFilename] of Object.entries(existing.files)) {
        if (adapterName === sourceName) continue;
        const adapter = this.adapters.get(adapterName);
        if (!adapter) continue;

        const targetPath = path.join(adapter.getWatchDir(), adapterFilename);
        try {
          this.state.startWrite(adapterName);
          await fs.unlink(targetPath);
          await adapter.afterDelete(adapterFilename);
          console.log(`  Deleted ${adapterName}/${adapterFilename} (source deleted)`);
        } catch {
          // Already gone
        } finally {
          setTimeout(() => this.state.endWrite(adapterName), 500);
        }
      }
    }

    this.state.remove(existing.id);
    await this.state.save();
  }

  /** Start watching all adapter directories */
  async watch() {
    await this.state.load();
    console.log('Starting file watchers...');

    for (const [adapterName, adapter] of this.adapters) {
      const dir = adapter.getWatchDir();
      const ignorePatterns = adapter.getIgnorePatterns();

      // Ensure directory exists
      await fs.mkdir(dir, { recursive: true });

      const watcher = watch(dir, {
        ignoreInitial: true,
        depth: 0,
        awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
      });

      const handleEvent = (eventType) => (filePath) => {
        if (!filePath.endsWith('.md')) return;
        this._debounced(adapterName, filePath, eventType);
      };

      watcher.on('add', handleEvent('change'));
      watcher.on('change', handleEvent('change'));
      watcher.on('unlink', handleEvent('delete'));

      this.watchers.push(watcher);
      console.log(`  Watching ${dir} (${adapterName})`);
    }
  }

  /** Debounce file events to avoid rapid-fire syncs */
  _debounced(adapterName, filePath, eventType) {
    const key = `${adapterName}:${filePath}`;
    if (this._debounceTimers.has(key)) {
      clearTimeout(this._debounceTimers.get(key));
    }

    this._debounceTimers.set(key, setTimeout(async () => {
      this._debounceTimers.delete(key);

      // Skip if we're the ones writing to this adapter
      if (this.state.isWriting(adapterName)) return;

      const filename = path.basename(filePath);
      const adapter = this.adapters.get(adapterName);

      // Skip ignored files
      if (adapter.getIgnorePatterns().includes(filename)) return;

      if (eventType === 'delete') {
        console.log(`[${adapterName}] Deleted: ${filename}`);
        await this.handleDelete(adapterName, filename);
      } else {
        console.log(`[${adapterName}] Changed: ${filename}`);
        await this.syncFile(adapterName, filename);
      }
    }, 400));
  }

  /** Stop all watchers */
  async stop() {
    for (const watcher of this.watchers) {
      await watcher.close();
    }
    this.watchers = [];
    console.log('Watchers stopped.');
  }
}
