import { BaseAdapter } from './base.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * Claude Code adapter.
 *
 * Memory format: Markdown files with YAML frontmatter (name, description, type)
 * Index: MEMORY.md in the same directory
 * Location: ~/.claude/projects/<project-path>/memory/
 */
export class ClaudeCodeAdapter extends BaseAdapter {
  constructor(config) {
    super('claude-code', config);
  }

  getIgnorePatterns() {
    return ['MEMORY.md'];
  }

  parseMemory(filename, content) {
    const parsed = parseFrontmatter(content);
    return {
      name: parsed.frontmatter.name || filenameToName(filename),
      description: parsed.frontmatter.description || '',
      type: parsed.frontmatter.type || 'project',
      body: parsed.body,
      source: extractBridgeSource(content) || 'claude-code',
      bridgeId: extractBridgeId(content),
    };
  }

  formatMemory(memory) {
    const filename = nameToFilename(memory.name);
    const sourceTag = memory.sourceAdapter !== 'claude-code'
      ? `\n<!-- memory-bridge-source: ${memory.sourceAdapter} -->`
      : '';
    const bridgeTag = memory.bridgeId
      ? `\n<!-- memory-bridge-id: ${memory.bridgeId} -->`
      : '';

    const content = `---
name: ${memory.name}
description: ${memory.description}
type: ${memory.type}
---

${memory.body}${sourceTag}${bridgeTag}
`;
    return { filename, content };
  }

  async afterWrite(memory, filename) {
    await this.updateIndex(memory, filename);
  }

  async afterDelete(filename) {
    await this.removeFromIndex(filename);
  }

  async updateIndex(memory, filename) {
    const indexPath = path.join(this.memoryDir, 'MEMORY.md');
    let indexContent = '';
    try {
      indexContent = await fs.readFile(indexPath, 'utf-8');
    } catch {
      indexContent = '# Claude Memory\n\n## Bridged Memories\n';
    }

    // Check if entry already exists
    if (indexContent.includes(`(${filename})`)) {
      return; // Already indexed
    }

    // Find or create the Bridged Memories section
    const sectionHeader = '## Bridged Memories';
    if (!indexContent.includes(sectionHeader)) {
      indexContent += `\n${sectionHeader}\n`;
    }

    const sourceLabel = memory.sourceAdapter !== 'claude-code'
      ? ` (from ${memory.sourceAdapter})`
      : '';
    const entry = `- [${memory.name}](${filename}) — ${memory.description}${sourceLabel}\n`;

    // Insert after the section header
    const idx = indexContent.indexOf(sectionHeader);
    const afterHeader = idx + sectionHeader.length;
    const nextNewline = indexContent.indexOf('\n', afterHeader);
    indexContent = indexContent.slice(0, nextNewline + 1) + entry + indexContent.slice(nextNewline + 1);

    await fs.writeFile(indexPath, indexContent, 'utf-8');
  }

  async removeFromIndex(filename) {
    const indexPath = path.join(this.memoryDir, 'MEMORY.md');
    try {
      let content = await fs.readFile(indexPath, 'utf-8');
      const lines = content.split('\n');
      const filtered = lines.filter(line => !line.includes(`(${filename})`));
      await fs.writeFile(indexPath, filtered.join('\n'), 'utf-8');
    } catch {
      // Index doesn't exist, nothing to do
    }
  }
}


// --- Helpers ---

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content.trim() };
  }

  const frontmatter = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      frontmatter[key] = value;
    }
  }

  // Strip bridge tags from body
  let body = match[2].trim();
  body = body.replace(/\n?<!-- memory-bridge-source: .+? -->/g, '');
  body = body.replace(/\n?<!-- memory-bridge-id: .+? -->/g, '');

  return { frontmatter, body: body.trim() };
}

function extractBridgeSource(content) {
  const match = content.match(/<!-- memory-bridge-source: (.+?) -->/);
  return match ? match[1] : null;
}

function extractBridgeId(content) {
  const match = content.match(/<!-- memory-bridge-id: (.+?) -->/);
  return match ? match[1] : null;
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
