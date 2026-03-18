---
title: update
description: Refresh methodology and prompt templates after upgrading ralph.
---

```bash
pnpm dlx @smplcty/ralph update
# or
npx @smplcty/ralph update
```

Refresh ralph-owned files after upgrading the package. Regenerates methodology docs and prompt templates without touching user-authored content.

## What It Updates

| File | Description |
| --- | --- |
| `docs/RALPH-METHODOLOGY.md` | Full methodology reference |
| `docs/prompts/boot.md` | Default boot prompt template |
| `docs/prompts/system.md` | Stable system-level prompt layer |
| `docs/prompts/README.md` | Prompt directory documentation |
| Agent instructions file | Regenerated from `ralph.config.json` (e.g., `.claude/CLAUDE.md`) |

## What It Preserves

- `docs/prompts/rules.md` — user-authored, never overwritten
- `docs/PRD.md` — user-authored
- `docs/tasks/*` — user-authored
- `ralph.config.json` — read as input, not modified

## Behavior

- Reads `ralph.config.json` for project configuration (errors if missing)
- Compares generated content against existing files — only writes if changed
- Reports which files were updated and which were already up to date
