# @smplcty/ralph

Stateless, PRD-driven AI development loop — your AI coding agent builds your project one task at a time using red/green TDD, automatically.

## Why Ralph?

- **Automated TDD** — every task goes through red/green/verify before committing
- **Task-driven development** — decompose your PRD into task files, ralph does the rest
- **Multi-agent support** — works with Claude Code, Gemini CLI, Codex CLI, Continue, and Cursor
- **Cost tracking** — token usage and cost breakdowns per task and milestone
- **Stateless** — each iteration boots from disk, no persistent agent state to corrupt

## Quick Start

```bash
# Initialize a new project
pnpm dlx @smplcty/ralph init
# or
npx @smplcty/ralph init

# Run the development loop
pnpm dlx @smplcty/ralph loop
# or
npx @smplcty/ralph loop
```

## Commands

| Command      | Description                                              |
| ------------ | -------------------------------------------------------- |
| `init`       | Interactive project bootstrapper — scaffolds ralph files |
| `loop`       | Main AI development loop — picks tasks and builds        |
| `monitor`    | Real-time progress dashboard with phase tracking         |
| `kill`       | Force-stop ralph and all child processes                 |
| `milestones` | Generate milestone summaries with cost breakdowns        |
| `shas`       | Backfill commit SHAs into task metadata                  |
| `cost`       | Calculate token usage and costs from log files           |
| `retry`      | Reset blocked tasks so they can be retried from scratch  |
| `update`     | Refresh methodology and prompt templates after upgrade   |

## Documentation

Full documentation: [https://mabulu-inc.github.io/ralph/](https://mabulu-inc.github.io/ralph/)

## Requirements

- Node.js 20+
