/**
 * Cross-agent instruction templates.
 *
 * When memory-bridge is set up, each agent harness gets instructions
 * telling it about the bridge, where to find memories from other agents,
 * and how to identify which memories are its own vs bridged.
 */

export const CODEX_INSTRUCTIONS = `# Memory Bridge

A memory-bridge service is running on this machine that syncs memories bidirectionally between you (Codex) and Claude Code. Memories you create are shared with Claude Code, and Claude Code's memories are shared with you.

## Where to find memories

- **Your memories (native):** \`~/.codex/memories/\` — files you created directly
- **Your project memories:** \`<project>/memory/\` — dated journal entries you write per-project
- **Bridged from Claude Code:** also in \`~/.codex/memories/\` — look for the \`<!-- memory-bridge\` header block with \`source: claude-code\`

## How to identify bridged memories

Files bridged from Claude Code have this header:
\`\`\`
<!-- memory-bridge
name: ...
source: claude-code
...
-->
\`\`\`

And a visible origin line:
\`\`\`
> **Origin:** claude-code | **Type:** project
\`\`\`

## How to identify your own memories

Your native memories in \`~/.codex/memories/\` will NOT have the \`<!-- memory-bridge\` header. Your project-level memories in \`<project>/memory/\` are always yours.

## When asked "what has Claude been working on"

Read the bridged files in \`~/.codex/memories/\` that have \`source: claude-code\` in their bridge header. These are Claude Code's actual memory files — project context, decisions, findings, and status updates.

## When you save a memory

The bridge will automatically sync it to Claude Code. No action needed on your part. Just save memories as you normally do (to \`~/.codex/memories/\` or \`<project>/memory/\`). The bridge watches both locations.
`;

export const CLAUDE_CODE_INSTRUCTIONS = `## Memory Bridge

A memory-bridge service is running on this machine that syncs memories bidirectionally between you (Claude Code) and Codex. Memories you create are shared with Codex, and Codex's memories are shared with you.

### Where to find memories

- **Your memories (native):** Your normal memory directory — files you created directly
- **Bridged from Codex:** Also in your memory directory — look for \`<!-- memory-bridge-source: codex -->\` at the bottom of the file
- **Codex project journals:** Bridged files prefixed with the project name (e.g., \`my-project-2026-03-18.md\`) are Codex's dated work logs

### How to identify bridged memories

Files bridged from Codex have this tag at the bottom:
\`\`\`
<!-- memory-bridge-source: codex -->
\`\`\`

And appear in the "Bridged Memories" section of MEMORY.md with "(from codex)" labels.

### How to identify your own memories

Your native memories will NOT have the \`<!-- memory-bridge-source:\` tag. If a file has YAML frontmatter but no bridge-source comment, it's yours.

### When asked "what has Codex been working on"

Read the bridged files that have \`memory-bridge-source: codex\` tags. Project journal files (prefixed with project names and dates) contain Codex's detailed daily work logs.

### When you save a memory

The bridge will automatically sync it to Codex. No action needed on your part. Just save memories as you normally do. The bridge watches your memory directory.
`;

/**
 * Generic template for new adapters. Replace placeholders.
 */
export const GENERIC_INSTRUCTIONS = (agentName, otherAgents) => `# Memory Bridge

A memory-bridge service is running on this machine that syncs memories bidirectionally between you (${agentName}) and ${otherAgents.join(', ')}. Memories you create are shared with other agents, and their memories are shared with you.

## How to identify bridged memories

Files synced from other agents will contain a bridge metadata header or tag indicating their source. Look for "memory-bridge" markers in the file content.

## When you save a memory

The bridge will automatically sync it to all connected agents. No action needed on your part.
`;
