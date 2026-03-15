---
title: Agent Overview
description: Multi-agent support and the provider abstraction pattern.
---

Ralph supports multiple AI coding agents through a provider abstraction. Each provider maps ralph's needs onto the agent's CLI interface, so the loop works identically regardless of which agent you choose.

## Supported Agents

| Agent          | Binary   | Print Mode        | JSON Output                   | Max Turns       | Instructions File         |
| -------------- | -------- | ----------------- | ----------------------------- | --------------- | ------------------------- |
| **Claude Code** | `claude` | `-p`              | `--output-format stream-json` | `--max-turns N` | `.claude/CLAUDE.md`       |
| **Gemini CLI** | `gemini` | `-p`              | `--output-format stream-json` | N/A             | `GEMINI.md`               |
| **Codex CLI**  | `codex`  | `exec` subcommand | `--json`                      | N/A             | `AGENTS.md`               |
| **Continue**   | `cn`     | `-p`              | `--output-format stream-json` | `--max-turns N` | `~/.continue/config.yaml` |
| **Cursor**     | `cursor` | `-p`              | `--output-format stream-json` | N/A             | `.cursor/rules/`          |

## Provider Interface

Every provider supplies:

| Capability                     | Description                                              |
| ------------------------------ | -------------------------------------------------------- |
| **binary**                     | CLI executable name                                      |
| **buildArgs(prompt, options)** | Construct the argument array for a headless invocation   |
| **outputFormat**               | How to request structured output                         |
| **supportsMaxTurns**           | Whether the agent accepts a max-turns limit              |
| **instructionsFile**           | Path to the agent's project-level instructions file      |
| **parseOutput(stream)**        | Normalize output into ralph's internal event format      |

## Choosing an Agent

Set the agent in `ralph.config.json`:

```json
{
  "agent": "claude"
}
```

Or override per-run:

```bash
pnpm dlx @mabulu-inc/ralph loop --agent gemini
```

During `ralph init`, the agent is auto-detected based on which CLIs are installed (preference: claude → gemini → codex → continue → cursor).

## Max Turns

For agents that don't support `--max-turns`, ralph relies on its timeout mechanism to bound iteration length. The complexity scaling tiers still apply to timeout values.
