---
title: loop
description: The main AI development loop that picks tasks and drives your agent through TDD.
---

```bash
pnpm dlx @smplcty/ralph loop
# or
npx @smplcty/ralph loop
```

The main AI development loop. Runs the configured AI coding agent in stateless iterations, each picking up the next eligible task.

## How It Works

Each iteration:

1. **Pre-flight** — verify agent CLI is installed, `docs/tasks/` and `docs/prompts/boot.md` exist, and quality check passes (aborts by default if it fails — use `--allow-dirty` to override)
2. **Database** — start Docker containers if configured
3. **Clean slate** — discard unstaged changes from crashed iterations
4. **Find next task** — select lowest-numbered eligible TODO
5. **Build prompt** — interpolate boot prompt template with task and config variables
6. **Launch agent** — spawn the agent CLI with the rendered prompt
7. **Monitor** — track progress via the agent's output stream
8. **Timeout** — kill iterations exceeding the time limit
9. **Commit detection** — end iteration after a commit lands
10. **Post-iteration** — backfill SHAs, update costs, regenerate milestones, push

## Options

| Flag                        | Description                          | Default          |
| --------------------------- | ------------------------------------ | ---------------- |
| `-n, --iterations <N>`      | Max iterations                       | `10` (0 = ∞)    |
| `-d, --delay <seconds>`     | Delay between iterations             | `2`              |
| `-t, --timeout <seconds>`   | Max seconds per iteration            | auto             |
| `-m, --max-turns <N>`       | Max agent turns per iteration        | auto             |
| `-v, --verbose`             | Stream agent output to terminal      | off              |
| `--dry-run`                 | Print config and exit                | off              |
| `--no-push`                 | Don't auto-push after iterations     | off              |
| `--no-db`                   | Skip database startup                | off              |
| `--allow-dirty`             | Proceed despite pre-existing quality-check failures | off |
| `--agent <name>`            | Override configured agent            | from config      |

## Task Complexity Scaling

Ralph auto-scales timeout and max-turns based on task characteristics:

| Tier     | Criteria                                       | Max Turns | Timeout |
| -------- | ---------------------------------------------- | --------- | ------- |
| Light    | 0–1 deps, 1–2 produces, no integration keyword | 50        | 600s    |
| Standard | 2–3 deps OR 3–4 produces                       | 75        | 900s    |
| Heavy    | 4+ deps OR 5+ produces OR integration keyword  | 125       | 1200s   |

CLI flags `-m` and `-t` override auto-scaling when provided.

## Retry Context

When a task fails (timeout, non-zero exit, no commit detected), the next attempt includes context from the failed iteration:

- Last phase reached (Boot, Red, Green, Verify, Commit)
- Last error or failure output
- Files modified before failure

This prevents the agent from repeating the same mistake.

## Exit Conditions

The loop stops when:

- All tasks are `DONE`
- Max iterations reached
- User interrupt (Ctrl+C)
