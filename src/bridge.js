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
        memoryDir: adapterConfig.memoryDir?.replace(/^~/, process.env.HOME),
        memoryDirs: adapterConfig.memoryDirs?.map(d => d.replace(/^~/, process.env.HOME)),
      };
      this.adapters.set(name, new AdapterClass(resolvedConfig));
    }
    console.log(`Loaded ${this.adapters.size} adapters: ${[...this.adapters.keys()].join(', ')}`);
  }

  /** Run a one-time sync across all adapters */
  async sync() {
    await this.state.load();

    for (const [sourceName, sourceAdapter] of this.adapters) {
      const dirs = sourceAdapter.getWatchDirs();
      const ignorePatterns = sourceAdapter.getIgnorePatterns();

      for (const dir of dirs) {
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
          await this.syncFile(sourceName, filename, dir);
        }
      }
    }

    await this.state.save();
    console.log('Sync complete.');
  }

  /** Sync a single file from source adapter to all other adapters */
  async syncFile(sourceName, filename, sourceDir) {
    const sourceAdapter = this.adapters.get(sourceName);
    // Use provided dir, or fall back to primary write dir
    const dir = sourceDir || sourceAdapter.getWriteDir();
    const filePath = path.join(dir, filename);

    let content;
    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch {
      return; // File disappeared
    }

    // Parse the memory (pass dir for project-level context)
    const memory = sourceAdapter.parseMemory(filename, content, dir);

    // If this memory originated from a bridge sync, don't re-sync it back
    const originalSource = memory.source;

    // Find or create bridge ID
    let bridgeId = memory.bridgeId;
    const stateKey = `${sourceName}:${dir}:${filename}`;
    let existing = bridgeId
      ? this.state.get(bridgeId)
      : this.state.findByFile(sourceName, filename, dir);

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

      const writeDir = targetAdapter.getWriteDir();
      const formatted = targetAdapter.formatMemory({
        ...memory,
        sourceAdapter: sourceName,
        bridgeId,
      });

      const targetPath = path.join(writeDir, formatted.filename);

      // Ensure target directory exists
      await fs.mkdir(writeDir, { recursive: true });

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
        setTimeout(() => this.state.endWrite(targetName), 500);
      }

      // Update state mapping
      this.state.set(bridgeId, {
        name: memory.name,
        hash: contentHash,
        files: {
          ...(existing?.files || {}),
          [sourceName]: `${dir}/${filename}`,
          [targetName]: `${writeDir}/${formatted.filename}`,
        },
      });
    }

    await this.state.save();
  }

  /** Handle a file deletion */
  async handleDelete(sourceName, filename, sourceDir) {
    const sourceAdapter = this.adapters.get(sourceName);
    const dir = sourceDir || sourceAdapter.getWriteDir();
    const existing = this.state.findByFile(sourceName, filename, dir);
    if (!existing) return;

    if (this.config.syncDeletes) {
      for (const [adapterName, filePath] of Object.entries(existing.files)) {
        if (adapterName === sourceName) continue;
        const adapter = this.adapters.get(adapterName);
        if (!adapter) continue;

        try {
          this.state.startWrite(adapterName);
          await fs.unlink(filePath);
          await adapter.afterDelete(path.basename(filePath));
          console.log(`  Deleted ${filePath} (source deleted)`);
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
      const dirs = adapter.getWatchDirs();

      for (const dir of dirs) {
        // Ensure directory exists
        await fs.mkdir(dir, { recursive: true });

        const watcher = watch(dir, {
          ignoreInitial: true,
          depth: 0,
          awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
        });

        const handleEvent = (eventType) => (filePath) => {
          if (!filePath.endsWith('.md')) return;
          this._debounced(adapterName, filePath, eventType, dir);
        };

        watcher.on('add', handleEvent('change'));
        watcher.on('change', handleEvent('change'));
        watcher.on('unlink', handleEvent('delete'));

        this.watchers.push(watcher);
        console.log(`  Watching ${dir} (${adapterName})`);
      }
    }
  }

  /** Debounce file events to avoid rapid-fire syncs */
  _debounced(adapterName, filePath, eventType, dir) {
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
        console.log(`[${adapterName}] Deleted: ${filename} (${dir})`);
        await this.handleDelete(adapterName, filename, dir);
      } else {
        console.log(`[${adapterName}] Changed: ${filename} (${dir})`);
        await this.syncFile(adapterName, filename, dir);
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
