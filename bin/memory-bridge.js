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

function printUsage() {
  console.log(`
memory-bridge — two-way memory sync between AI coding agents

Usage:
  memory-bridge start       Start watching and syncing (default)
  memory-bridge sync        One-time sync, then exit
  memory-bridge status      Show current sync state
  memory-bridge config      Show config location and contents
  memory-bridge help        Show this message

Config: ${CONFIG_FILE}
State:  ${path.join(CONFIG_DIR, 'state.json')}
`);
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
        .map(([adapter, file]) => `${adapter}:${file}`)
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
