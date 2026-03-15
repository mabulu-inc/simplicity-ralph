---
title: Codex CLI
description: Setup and configuration for Codex CLI with ralph.
---

## Prerequisites

Install the Codex CLI:

```bash
npm install -g @openai/codex
```

## Configuration

```json
{
  "agent": "codex",
  "model": "o3"
}
```

## How Ralph Uses It

Ralph spawns Codex CLI with:

```bash
codex exec "<boot prompt>" --json
```

- `exec` — non-interactive execution subcommand
- `--json` — structured JSON output
- No `--max-turns` support — ralph uses its timeout mechanism

## Instructions File

Ralph generates `AGENTS.md` at the project root during `init`.
