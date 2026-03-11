# @simplicity/ralph — Claude Code Instructions

## Project Goal

Build `@simplicity/ralph` — a CLI tool implementing the Ralph Methodology (stateless, PRD-driven AI development automated by AI coding agents).
Requirements are defined in `docs/PRD.md`.

## Methodology

Follow the Ralph Methodology defined in `docs/RALPH-METHODOLOGY.md`.

## Project-Specific Config

- **Language**: TypeScript (strict mode)
- **File naming**: kebab-case
- **Package manager**: pnpm
- **Testing framework**: Vitest
- **Quality check**: `pnpm check` (lint → format → typecheck → build → test:coverage)
- **Test command**: `pnpm test`

## Project-Specific Rules

- **Do NOT use TodoWrite** — it wastes turns and provides no value in a stateless loop
- **Do NOT explore library internals** (node_modules) unless a specific error requires it
- **All ralph code goes under `src/ralph/`** — CLI entry point is `src/ralph/cli.ts`
- **No database required** — ralph itself has no database dependency
- **Tests go under `src/ralph/__tests__/`**
