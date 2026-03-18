import { BaseAdapter } from './base.js';

/**
 * Codex (OpenAI) adapter.
 *
 * Memory format: Plain markdown files in ~/.codex/memories/
 * No frontmatter, no index file. Codex reads all .md files as context.
 */
export class CodexAdapter extends BaseAdapter {
  constructor(config) {
    super('codex', config);
  }

  getIgnorePatterns() {
    return [];
  }

  parseMemory(filename, content) {
    // Extract metadata from bridge header block if present
    const meta = extractBridgeHeader(content);
    const body = stripBridgeHeader(content);

    return {
      name: meta.name || filenameToName(filename),
      description: meta.description || '',
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
