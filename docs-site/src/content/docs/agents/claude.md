---
title: Claude Code
description: Setup and configuration for Claude Code with ralph.
---

[Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) is ralph's default agent.

## Prerequisites

Install the Claude Code CLI:

```bash
npm install -g @anthropic-ai/claude-code
```

## Configuration

```json
{
  "agent": "claude",
  "model": "claude-sonnet-4-5-20250514"
}
```

The `model` field is optional — Claude Code uses its default model if omitted.

## How Ralph Uses It

Ralph spawns Claude Code with:

```bash
claude -p "<boot prompt>" --output-format stream-json --max-turns N --model <model>
```

- `-p` — print mode (non-interactive, single prompt)
- `--output-format stream-json` — structured JSONL output for log capture
- `--max-turns` — limits agent turns based on task complexity
- `--model` — optional model override

## Instructions File

Ralph generates `.claude/CLAUDE.md` during `init` with a project goal and methodology pointer. Behavioral rules flow through the boot prompt, not this file.
