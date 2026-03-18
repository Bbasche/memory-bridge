import { BaseAdapter } from './base.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * Codex (OpenAI) adapter.
 *
 * Supports two memory patterns:
 * 1. Global: ~/.codex/memories/ — flat .md files
 * 2. Project-level: <project>/memory/ — dated .md files (2026-03-18.md)
 *    with a MEMORY.md index in the project root
 *
 * Both are watched. Writes go to the global dir. Project-level memories
 * are synced out with a project prefix to avoid filename collisions.
 */
export class CodexAdapter extends BaseAdapter {
  constructor(config) {
    super('codex', config);
    // Project dirs: paths to project roots that contain memory/ subdirs
    this.projectDirs = (config.projectDirs || []).map(d =>
      d.replace(/^~/, process.env.HOME)
    );
  }

  /** Watch the global memories dir + all project memory/ subdirs */
  getWatchDirs() {
    const dirs = [...this.memoryDirs];
    for (const projDir of this.projectDirs) {
      dirs.push(path.join(projDir, 'memory'));
    }
    return dirs;
  }

  getIgnorePatterns() {
    return ['MEMORY.md'];
  }

  parseMemory(filename, content, dir) {
    // Check if this is from a project dir (vs global)
    const projectDir = this.projectDirs.find(p =>
      dir === path.join(p, 'memory')
    );

    // Extract metadata from bridge header block if present
    const meta = extractBridgeHeader(content);
    const body = stripBridgeHeader(content);

    let name = meta.name || filenameToName(filename);

    // Prefix project-level memories with project name for uniqueness
    if (projectDir && !meta.name) {
      const projectName = path.basename(projectDir);
      name = `${projectName} — ${name}`;
    }

    return {
      name,
      description: meta.description || (projectDir ? `Project memory from ${path.basename(projectDir)}` : ''),
      type: meta.type || 'project',
      body,
      source: meta.source || 'codex',
      bridgeId: meta.bridgeId || null,
    };
  }

  formatMemory(memory) {
    const filename = nameToFilename(memory.name);
    const sourceLabel = memory.sourceAdapter !== 'codex'
      ? memory.sourceAdapter
      : 'codex';

    // Write as readable markdown with a structured header block
    // that Codex can read naturally and the bridge can parse
    const content = `<!-- memory-bridge
name: ${memory.name}
description: ${memory.description}
type: ${memory.type}
source: ${sourceLabel}
bridge-id: ${memory.bridgeId || ''}
-->

# ${memory.name}

> **Origin:** ${sourceLabel} | **Type:** ${memory.type}

${memory.body}
`;
    return { filename, content };
  }
}


// --- Helpers ---

function extractBridgeHeader(content) {
  const match = content.match(/<!-- memory-bridge\n([\s\S]*?)-->/);
  if (!match) return {};

  const meta = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const value = line.slice(colonIdx + 1).trim();
      if (value) meta[key] = value;
    }
  }
  return meta;
}

function stripBridgeHeader(content) {
  let body = content.replace(/<!-- memory-bridge\n[\s\S]*?-->\n*/, '');
  // Also strip the "# Name" heading and origin line that we add
  body = body.replace(/^# .+\n+/m, '');
  body = body.replace(/^> \*\*Origin:\*\*.+\n*/m, '');
  return body.trim();
}

function filenameToName(filename) {
  return filename
    .replace(/\.md$/, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function nameToFilename(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim() + '.md';
}
