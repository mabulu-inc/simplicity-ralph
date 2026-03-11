# Project Rules

<!-- These rules are injected into every boot prompt via {{project.rules}}.
     They apply to every task and every agent. Edit freely. -->

- Do NOT use TodoWrite — it wastes turns and provides no value in a stateless loop
- Do NOT explore library internals (node_modules) unless a specific error requires it
- All ralph code goes under `src/ralph/` — CLI entry point is `src/ralph/cli.ts`
- Tests go under `src/ralph/__tests__/`
- File naming: kebab-case
- No database required — ralph itself has no database dependency
