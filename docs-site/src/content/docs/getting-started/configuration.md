---
title: Configuration
description: ralph.config.json fields, supported agents, and project settings.
---

Ralph reads configuration from `ralph.config.json` at the project root.

## Required Fields

```json
{
  "language": "TypeScript",
  "packageManager": "pnpm",
  "testingFramework": "Vitest",
  "qualityCheck": "pnpm check",
  "testCommand": "pnpm test",
  "agent": "claude"
}
```

| Field              | Description                                           | Example              |
| ------------------ | ----------------------------------------------------- | -------------------- |
| `language`         | Project language                                      | `TypeScript`         |
| `packageManager`   | Package manager used by the project                   | `pnpm`               |
| `testingFramework` | Testing framework                                     | `Vitest`             |
| `qualityCheck`     | Command that must pass before committing               | `pnpm check`         |
| `testCommand`      | Command to run tests                                  | `pnpm test`          |
| `agent`            | AI coding agent to use                                | `claude`             |

## Optional Fields

| Field        | Description                                           | Example              |
| ------------ | ----------------------------------------------------- | -------------------- |
| `model`      | Model override (otherwise uses agent default)         | `claude-sonnet-4-5-20250514` |
| `database`   | Database setup details                                | `PostgreSQL`         |
| `fileNaming` | File naming convention                                | `kebab-case`         |

## Supported Agents

| Agent          | Binary   | Config value |
| -------------- | -------- | ------------ |
| Claude Code    | `claude` | `claude`     |
| Gemini CLI     | `gemini` | `gemini`     |
| Codex CLI      | `codex`  | `codex`      |
| Continue       | `cn`     | `continue`   |
| Cursor         | `cursor` | `cursor`     |

The agent is auto-detected during `ralph init` based on which CLIs are installed. You can change it at any time by editing `ralph.config.json`.

## Agent Instructions Files

Each agent has its own instructions file that ralph generates during `init`:

| Agent     | Instructions File         |
| --------- | ------------------------- |
| Claude    | `.claude/CLAUDE.md`       |
| Gemini    | `GEMINI.md`               |
| Codex     | `AGENTS.md`               |
| Continue  | `~/.continue/config.yaml` |
| Cursor    | `.cursor/rules/`          |

These files contain a project goal and a pointer to the Ralph Methodology — all behavioral rules flow through the boot prompt template, not the instructions file.
