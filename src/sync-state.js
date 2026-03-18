import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const STATE_DIR = path.join(process.env.HOME, '.memory-bridge');
const STATE_FILE = path.join(STATE_DIR, 'state.json');

/**
 * Tracks which memories have been synced and their content hashes
 * to prevent infinite sync loops and redundant writes.
 */
export class SyncState {
  constructor() {
    this.state = { synced: {}, version: 1 };
    this._writing = new Set(); // adapters currently being written to
  }

  async load() {
    try {
      const raw = await fs.readFile(STATE_FILE, 'utf-8');
      this.state = JSON.parse(raw);
    } catch {
      this.state = { synced: {}, version: 1 };
    }
  }

  async save() {
    await fs.mkdir(STATE_DIR, { recursive: true });
    await fs.writeFile(STATE_FILE, JSON.stringify(this.state, null, 2), 'utf-8');
  }

  /** Generate a bridge ID for a new memory */
  generateId() {
    return crypto.randomUUID();
  }

  /** Hash content for change detection */
  hash(content) {
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  /** Look up a synced entry by bridge ID */
  get(bridgeId) {
    return this.state.synced[bridgeId] || null;
  }

  /** Find a synced entry by adapter + filename */
  findByFile(adapterName, filename) {
    for (const [id, entry] of Object.entries(this.state.synced)) {
      if (entry.files[adapterName] === filename) {
        return { id, ...entry };
      }
    }
    return null;
  }

  /** Record a sync mapping */
  set(bridgeId, data) {
    this.state.synced[bridgeId] = {
      ...this.state.synced[bridgeId],
      ...data,
      lastSync: new Date().toISOString(),
    };
  }

  /** Remove a sync mapping */
  remove(bridgeId) {
    delete this.state.synced[bridgeId];
  }

  /** Mark an adapter as "currently writing" (for loop prevention) */
  startWrite(adapterName) {
    this._writing.add(adapterName);
  }

  /** Clear the "currently writing" flag */
  endWrite(adapterName) {
    this._writing.delete(adapterName);
  }

  /** Check if an adapter is currently being written to by the bridge */
  isWriting(adapterName) {
    return this._writing.has(adapterName);
  }
}
