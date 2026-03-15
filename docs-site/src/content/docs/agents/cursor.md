---
title: Cursor
description: Setup and configuration for Cursor with ralph.
---

## Prerequisites

Install Cursor and ensure the `cursor` CLI is available on your PATH.

## Configuration

```json
{
  "agent": "cursor"
}
```

## How Ralph Uses It

Ralph spawns Cursor with:

```bash
cursor -p "<boot prompt>" --output-format stream-json
```

- `-p` — print mode (non-interactive, single prompt)
- `--output-format stream-json` — structured JSONL output
- No `--max-turns` support — ralph uses its timeout mechanism

## Instructions File

Cursor uses `.cursor/rules/` directory for project-level rules. Ralph generates a rules file during `init`.
