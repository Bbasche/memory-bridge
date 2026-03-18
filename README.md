# memory-bridge

Two-way memory sync between AI coding agents. When one agent saves a memory, the bridge syncs it to all others — with clear provenance so each agent knows which memories are its own vs. bridged from elsewhere.

Currently supports **Claude Code** and **Codex**. Extensible to any agent harness via adapters.

## Install

```bash
npm install -g memory-bridge
```

Or run directly:

```bash
npx memory-bridge
```

## Usage

```bash
# Start watching and syncing (runs in foreground)
memory-bridge start

# One-time sync, then exit
memory-bridge sync

# Show what's synced
memory-bridge status

# Show config
memory-bridge config
```

## How it works

1. Each agent harness gets an **adapter** that knows how to read/write its native memory format
2. The bridge watches all adapter directories for changes
3. When a memory is created or updated, it syncs to all other adapters
4. Each synced memory is tagged with its **origin** so agents know "this is mine" vs "this came from another agent"
5. Content hashing prevents infinite sync loops and redundant writes

### Memory provenance

**In Claude Code** (receiving from Codex):
```markdown
---
name: Some Memory
description: What it's about
type: project
---

The memory content...
<!-- memory-bridge-source: codex -->
```

**In Codex** (receiving from Claude Code):
```markdown
<!-- memory-bridge ... source: claude-code -->

# Some Memory
> **Origin:** claude-code | **Type:** project

The memory content...
```

Both agents can immediately see where a memory came from and treat it accordingly.

## Config

Config lives at `~/.memory-bridge/config.json`. Created automatically on first run.

```json
{
  "adapters": {
    "claude-code": {
      "type": "claude-code",
      "memoryDir": "~/.claude/projects/-Users-you/memory"
    },
    "codex": {
      "type": "codex",
      "memoryDir": "~/.codex/memories"
    }
  },
  "syncDeletes": false,
  "syncBackToOrigin": false
}
```

- **syncDeletes**: When `true`, deleting a memory in one agent removes it from all others
- **syncBackToOrigin**: When `true`, a memory bridged from Agent A and modified in Agent B will sync back to A

## Adding a new adapter

Create a class extending `BaseAdapter`:

```js
import { BaseAdapter } from 'memory-bridge/src/adapters/base.js';

export class CursorAdapter extends BaseAdapter {
  constructor(config) {
    super('cursor', config);
  }

  getIgnorePatterns() { return []; }

  parseMemory(filename, content) {
    return {
      name: '...',
      description: '...',
      type: 'project',
      body: '...',
      source: 'cursor',
      bridgeId: null,
    };
  }

  formatMemory(memory) {
    return {
      filename: 'something.md',
      content: '...',
    };
  }
}
```

Then register it in `src/bridge.js`:

```js
import { CursorAdapter } from './adapters/cursor.js';
ADAPTER_TYPES['cursor'] = CursorAdapter;
```

And add to your config:

```json
{
  "adapters": {
    "cursor": {
      "type": "cursor",
      "memoryDir": "~/.cursor/memories"
    }
  }
}
```

## Run as a background service (macOS)

```bash
# Create a launchd plist
cat > ~/Library/LaunchAgents/com.memory-bridge.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.memory-bridge</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/usr/local/bin/memory-bridge</string>
        <string>start</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/memory-bridge.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/memory-bridge.log</string>
</dict>
</plist>
EOF

launchctl load ~/Library/LaunchAgents/com.memory-bridge.plist
```

## License

MIT
