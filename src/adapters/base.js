/**
 * Base adapter interface for memory-bridge.
 * Extend this to add support for a new agent harness.
 */
export class BaseAdapter {
  constructor(name, config) {
    this.name = name;
    this.config = config;
    // Support both single memoryDir and array memoryDirs
    // First dir is the "primary" (write target)
    if (config.memoryDirs) {
      this.memoryDirs = config.memoryDirs;
    } else if (config.memoryDir) {
      this.memoryDirs = [config.memoryDir];
    } else {
      this.memoryDirs = [];
    }
    this.memoryDir = this.memoryDirs[0] || null;
  }

  /** Return all directories to watch for memory changes */
  getWatchDirs() {
    return this.memoryDirs;
  }

  /** Return the primary directory (write target) */
  getWriteDir() {
    return this.memoryDir;
  }

  /** Files to ignore (e.g., index files that shouldn't be treated as memories) */
  getIgnorePatterns() {
    return [];
  }

  /**
   * Parse a native memory file into canonical format.
   * @param {string} filename - The filename (not full path)
   * @param {string} content - Raw file content
   * @param {string} dir - The directory the file is in
   * @returns {{ name, description, type, body, source }} Canonical memory
   */
  parseMemory(filename, content, dir) {
    throw new Error(`${this.name}: parseMemory() not implemented`);
  }

  /**
   * Convert a canonical memory into native format for this adapter.
   * @param {object} memory - Canonical memory { name, description, type, body, source, sourceAdapter }
   * @returns {{ filename: string, content: string }}
   */
  formatMemory(memory) {
    throw new Error(`${this.name}: formatMemory() not implemented`);
  }

  /**
   * Called after a memory is written. Use for updating index files, etc.
   * @param {object} memory - The canonical memory that was written
   * @param {string} filename - The filename it was written to
   */
  async afterWrite(memory, filename) {
    // Optional hook — override if needed
  }

  /**
   * Called after a memory is deleted from this adapter.
   * @param {string} filename - The filename that was removed
   */
  async afterDelete(filename) {
    // Optional hook — override if needed
  }
}
