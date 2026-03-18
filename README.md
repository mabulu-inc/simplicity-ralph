# @smplcty/ralph

Stateless, PRD-driven AI development loop — your AI coding agent builds your project one task at a time using red/green TDD, automatically.

## Why Ralph?

- **Automated TDD** — every task goes through red/green/verify before committing
- **Task-driven development** — decompose your PRD into task files, ralph does the rest
- **Multi-agent support** — works with Claude Code, Gemini CLI, Codex CLI, Continue, and Cursor
- **Cost tracking** — token usage and cost breakdowns per task and milestone
- **Stateless** — each iteration boots from disk, no persistent agent state to corrupt

## How It Works

Ralph follows a simple workflow: **PRD → Tasks → Loop**.

1. **You write a PRD** — a product requirements document that describes what to build, broken into numbered sections.
2. **You decompose the PRD into task files** — small, ordered units of work that reference PRD sections.
3. **Ralph runs the loop** — it picks up the next eligible task, launches an AI coding agent, and the agent implements the task using red/green TDD. When it commits, ralph moves to the next task.

Each iteration is stateless: the agent boots from disk, reads the task, writes failing tests, implements the minimum to pass, runs quality checks, commits, and stops. No memory carries over between tasks — the PRD and task files are the source of truth.

## Getting Started

### 1. Initialize your project

```bash
npx @smplcty/ralph init
```

This interactive command scaffolds everything ralph needs:

- `docs/PRD.md` — a skeleton PRD for you to fill in with your requirements
- `docs/tasks/T-000.md` — an initial bootstrap task
- `docs/prompts/boot.md` — the prompt template that drives each agent session
- `docs/prompts/rules.md` — project-specific rules (e.g., "all code goes under `src/`")
- `ralph.config.json` — project configuration (language, test framework, quality check command, etc.)
- Agent instructions file (e.g., `.claude/CLAUDE.md`) — a minimal stub pointing to the methodology

### 2. Write your PRD

Open `docs/PRD.md` and describe what you're building. Use numbered sections — tasks will reference these by section number (e.g., `§3.2`). The PRD doesn't need to be formal; it needs to be specific enough that an AI agent can implement it.

```markdown
# My Project — Product Requirements Document

## 1. User Authentication

Users can sign up with email/password and log in...

### 1.1 Registration

...

### 1.2 Login

...
```

### 3. Create task files

Each task is a Markdown file in `docs/tasks/` with a specific format:

```markdown
# T-001: Implement user registration endpoint

- **Status**: TODO
- **Milestone**: 1 — Authentication
- **Depends**: T-000
- **PRD Reference**: §1.1
- **Complexity**: standard

## Description

Build the POST /api/register endpoint that accepts email and password,
validates input, hashes the password, and stores the user record.

## AC

- [ ] POST /api/register returns 201 with valid input
- [ ] Returns 400 for missing or invalid fields
- [ ] Passwords are hashed before storage
```

Key fields:

- **Status** — `TODO` or `DONE`. Ralph picks up `TODO` tasks.
- **Depends** — other tasks that must be `DONE` first. Use `none` if there are no dependencies.
- **PRD Reference** — which PRD section this task implements (e.g., `§1.1`). Ralph injects the referenced section content into the agent's prompt automatically.
- **Complexity** — `light`, `standard`, or `heavy`. Controls how many agent turns and how much time the loop allocates. If omitted, ralph estimates based on the task content.

### 4. Run the loop

```bash
npx @smplcty/ralph loop
```

Ralph finds the lowest-numbered eligible task (status `TODO`, all dependencies `DONE`) and launches your configured AI agent with a boot prompt that includes the task description, referenced PRD section, and project rules. The agent then:

1. **Boot** — reads the task file and referenced PRD sections
2. **Red** — writes failing tests based on the acceptance criteria
3. **Green** — implements the minimum code to make tests pass
4. **Verify** — runs the quality check command (lint, format, typecheck, build, test)
5. **Commit** — commits with the format `T-NNN: description` and marks the task `DONE`

After the commit, ralph moves to the next eligible task. This continues until all tasks are done, the iteration limit is reached, or you press Ctrl+C.

Common options:

```bash
ralph loop --verbose          # Stream agent output to terminal
ralph loop --iterations 5     # Stop after 5 tasks
ralph loop --no-push          # Don't auto-push after iterations
ralph loop --dry-run          # Print config and exit
```

### 5. Monitor progress

In a separate terminal:

```bash
npx @smplcty/ralph monitor --watch
```

This shows a live dashboard with the current task, phase progress, and recent agent output.

## Commands

| Command   | Description                                              |
| --------- | -------------------------------------------------------- |
| `init`    | Interactive project bootstrapper — scaffolds ralph files |
| `loop`    | Main AI development loop — picks tasks and builds        |
| `monitor` | Real-time progress dashboard with phase tracking         |
| `retry`   | Reset blocked tasks so they can be retried from scratch  |
| `update`  | Refresh methodology and prompt templates after upgrade   |

## Requirements

- Node.js 20+

## Documentation

Full documentation: [https://mabulu-inc.github.io/simplicity-ralph/](https://mabulu-inc.github.io/simplicity-ralph/)
