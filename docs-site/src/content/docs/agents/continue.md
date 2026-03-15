---
title: Continue
description: Setup and configuration for Continue with ralph.
---

## Prerequisites

Install the Continue CLI:

```bash
npm install -g @anthropic-ai/continue-cli
```

## Configuration

```json
{
  "agent": "continue"
}
```

## How Ralph Uses It

Ralph spawns Continue with:

```bash
cn -p "<boot prompt>" --output-format stream-json --max-turns N
```

- `-p` — print mode (non-interactive, single prompt)
- `--output-format stream-json` — structured JSONL output
- `--max-turns` — supported, limits agent turns

## Instructions File

Continue uses `~/.continue/config.yaml` for configuration.
