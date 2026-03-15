---
title: Gemini CLI
description: Setup and configuration for Gemini CLI with ralph.
---

## Prerequisites

Install the Gemini CLI:

```bash
npm install -g @anthropic-ai/gemini-cli
```

## Configuration

```json
{
  "agent": "gemini",
  "model": "gemini-2.5-pro"
}
```

## How Ralph Uses It

Ralph spawns Gemini CLI with:

```bash
gemini -p "<boot prompt>" --output-format stream-json
```

- `-p` — print mode (non-interactive, single prompt)
- `--output-format stream-json` — structured JSONL output
- No `--max-turns` support — ralph uses its timeout mechanism

## Instructions File

Ralph generates `GEMINI.md` at the project root during `init`.
