#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import { MemoryBridge } from '../src/bridge.js';

const CONFIG_DIR = path.join(process.env.HOME, '.memory-bridge');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG = {
  adapters: {
    'claude-code': {
      type: 'claude-code',
      memoryDir: '~/.claude/projects/-Users-' + process.env.USER + '/memory',
    },
    codex: {
      type: 'codex',
      memoryDir: '~/.codex/memories',
      projectDirs: [],
    },
  },
  syncDeletes: false,
  syncBackToOrigin: false,
};

async function loadConfig() {
  await fs.mkdir(CONFIG_DIR, { recursive: true });

  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    // Write default config
    await fs.writeFile(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
    console.log(`Created default config at ${CONFIG_FILE}`);
    return DEFAULT_CONFIG;
  }
}

async function saveConfig(config) {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

function printUsage() {
  console.log(`
memory-bridge — two-way memory sync between AI coding agents

Usage:
  memory-bridge start       Start watching and syncing (default)
  memory-bridge sync        One-time sync, then exit
  memory-bridge scan        Auto-discover Codex project memory dirs
  memory-bridge status      Show current sync state
  memory-bridge config      Show config location and contents
  memory-bridge help        Show this message

Config: ${CONFIG_FILE}
State:  ${path.join(CONFIG_DIR, 'state.json')}
`);
}

/** Scan home directory for Codex project-level memory/ dirs */
async function scanProjectDirs() {
  const home = process.env.HOME;
  const found = [];

  let entries;
  try {
    entries = await fs.readdir(home, { withFileTypes: true });
  } catch {
    return found;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;

    const projDir = path.join(home, entry.name);
    const memDir = path.join(projDir, 'memory');

    try {
      const memStat = await fs.stat(memDir);
      if (!memStat.isDirectory()) continue;

      // Check if it has .md files (not just an empty dir)
      const files = await fs.readdir(memDir);
      const mdFiles = files.filter(f => f.endsWith('.md'));
      if (mdFiles.length === 0) continue;

      // Check for MEMORY.md in project root (Codex pattern)
      try {
        await fs.access(path.join(projDir, 'MEMORY.md'));
        found.push({ dir: projDir, memoryCount: mdFiles.length });
      } catch {
        // No MEMORY.md — might be a different project, skip
      }
    } catch {
      continue;
    }
  }

  return found;
}

async function runScan() {
  console.log('Scanning for Codex project memory directories...\n');
  const projects = await scanProjectDirs();

  if (projects.length === 0) {
    console.log('No project memory directories found.');
    return;
  }

  console.log(`Found ${projects.length} project(s) with memory dirs:\n`);
  for (const p of projects) {
    console.log(`  ${p.dir}/memory/ (${p.memoryCount} files)`);
  }

  // Update config
  const config = await loadConfig();
  const codexConfig = config.adapters.codex || config.adapters['codex'];
  if (!codexConfig) {
    console.log('\nNo codex adapter in config. Add one first.');
    return;
  }

  const existing = codexConfig.projectDirs || [];
  const newDirs = projects
    .map(p => p.dir)
    .filter(d => !existing.includes(d) && !existing.includes(d.replace(process.env.HOME, '~')));

  if (newDirs.length === 0) {
    console.log('\nAll directories already in config.');
    return;
  }

  codexConfig.projectDirs = [...existing, ...newDirs.map(d => d.replace(process.env.HOME, '~'))];
  await saveConfig(config);
  console.log(`\nAdded ${newDirs.length} project dir(s) to config.`);
  console.log(`Restart the bridge to pick them up.`);
}

async function showStatus() {
  const stateFile = path.join(CONFIG_DIR, 'state.json');
  try {
    const raw = await fs.readFile(stateFile, 'utf-8');
    const state = JSON.parse(raw);
    const entries = Object.entries(state.synced);

    if (entries.length === 0) {
      console.log('No memories synced yet.');
      return;
    }

    console.log(`${entries.length} memories synced:\n`);
    for (const [id, entry] of entries) {
      const files = Object.entries(entry.files)
        .map(([adapter, file]) => `${adapter}:${path.basename(file)}`)
        .join(' ↔ ');
      console.log(`  ${entry.name}`);
      console.log(`    ${files}`);
      console.log(`    Last sync: ${entry.lastSync}`);
      console.log();
    }
  } catch {
    console.log('No sync state found. Run `memory-bridge sync` first.');
  }
}

async function showConfig() {
  console.log(`Config: ${CONFIG_FILE}\n`);
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf-8');
    console.log(raw);
  } catch {
    console.log('No config found. Run `memory-bridge start` to create defaults.');
  }
}

// --- Main ---

const command = process.argv[2] || 'start';

switch (command) {
  case 'help':
  case '--help':
  case '-h':
    printUsage();
    break;

  case 'status':
    await showStatus();
    break;

  case 'config':
    await showConfig();
    break;

  case 'scan':
    await runScan();
    break;

  case 'sync': {
    const config = await loadConfig();
    const bridge = new MemoryBridge(config);
    bridge.init();
    console.log('Running one-time sync...');
    await bridge.sync();
    break;
  }

  case 'start': {
    const config = await loadConfig();
    const bridge = new MemoryBridge(config);
    bridge.init();

    // Initial sync
    console.log('Initial sync...');
    await bridge.sync();

    // Start watching
    await bridge.watch();

    console.log('\nBridge is running. Press Ctrl+C to stop.\n');

    // Graceful shutdown
    const shutdown = async () => {
      console.log('\nShutting down...');
      await bridge.stop();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    break;
  }

  default:
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
}
