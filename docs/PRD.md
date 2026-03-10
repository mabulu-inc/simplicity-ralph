# @simplicity/ralph — Product Requirements Document

A CLI tool that implements the Ralph Methodology: stateless, PRD-driven AI development automated by Claude Code.

Any project can `npx @simplicity/ralph init` to bootstrap, then `ralph loop` to build.

## 1. Task File Format

Ralph's unit of work is a **task file** (`docs/tasks/T-NNN.md`). Each file has:

```markdown
# T-NNN: Short title

- **Status**: TODO | DONE
- **Milestone**: N — Name
- **Depends**: T-XXX, T-YYY (or "none")
- **PRD Reference**: §N.N
- **Completed**: YYYY-MM-DD HH:MM (Nm duration)
- **Commit**: <SHA>
- **Cost**: $N.NN

## Description

What to implement and why.

## Produces

- `path/to/file.ts`
- Tests
```

### 1.1 Task Eligibility

A task is **eligible** when:

- Its status is `TODO`
- All tasks listed in `Depends` have status `DONE`
- It has no `## Blocked` section

The **next task** is the lowest-numbered eligible task.

### 1.2 Task Completion

When a task is completed, update in the same commit:

- `Status` → `DONE`
- `Completed` → timestamp with duration
- `Commit` → the commit SHA
- Add `## Completion Notes` section

## 2. Project Configuration

Ralph reads project configuration from `.claude/CLAUDE.md`. This is the same file Claude Code uses, so there's no separate config file.

### 2.1 Required Config Fields

Ralph extracts these from CLAUDE.md (from the `## Project-Specific Config` section):

- **Language** — e.g., TypeScript, Python, Go
- **Package manager** — e.g., pnpm, npm, yarn, pip, cargo
- **Testing framework** — e.g., Vitest, Jest, pytest
- **Quality check** — the command that must pass before committing (e.g., `pnpm check`)
- **Test command** — the command to run tests (e.g., `pnpm test`)

### 2.2 Optional Config

- **Database** — if the project uses a database (Docker setup, connection string)
- **File naming** — naming convention (kebab-case, snake_case, etc.)

## 3. Commands

### 3.1 `ralph init`

Interactive project bootstrapper. Prompts for project configuration, then creates the Ralph methodology scaffolding.

**Prompts:**

1. Project name
2. Language (TypeScript, Python, Go, Rust, etc.)
3. Package manager (pnpm, npm, yarn, pip, cargo, etc.)
4. Test framework (Vitest, Jest, pytest, etc.)
5. Check command — required. If none exists, ralph helps set one up.
6. Database (none, PostgreSQL via Docker, etc.)

**Creates:**

- `docs/PRD.md` — skeleton PRD with numbered sections to fill in
- `docs/RALPH-METHODOLOGY.md` — full methodology reference
- `docs/tasks/T-000.md` — infrastructure bootstrap task
- `.claude/CLAUDE.md` — project config filled in with answers above

**Behavior:**

- If files already exist, warn and ask before overwriting
- If applicable (Node.js projects), add ralph scripts to `package.json`
- If no check command exists, scaffold one (e.g., add a `check` script to `package.json`)

### 3.2 `ralph loop`

The main AI development loop. Runs Claude Code in stateless iterations, each picking up the next eligible task.

**Iteration cycle:**

1. **Pre-flight** — verify `claude` CLI is available, `docs/tasks/` exists
2. **Database** — if project has Docker Compose, start containers before each iteration
3. **Clean slate** — discard unstaged changes from crashed iterations
4. **Find next task** — scan task files, select lowest-numbered eligible TODO
5. **Launch Claude** — spawn `claude --print` with the boot prompt
6. **Monitor** — track progress via JSON stream output (tool use, phases, errors)
7. **Timeout** — kill iterations exceeding the time limit
8. **Commit detection** — after a commit lands, end the iteration (one task per iteration)
9. **Post-iteration** — backfill SHAs, update costs, regenerate milestones, push

**Options:**

- `-n, --iterations <N>` — max iterations (default: 10, 0 = unlimited)
- `-d, --delay <seconds>` — delay between iterations (default: 2)
- `-t, --timeout <seconds>` — max seconds per iteration (default: 900)
- `-v, --verbose` — stream Claude output to terminal
- `--dry-run` — print config and exit
- `--no-push` — don't auto-push after iterations
- `--no-db` — skip database startup

**Exit conditions:**

- All tasks are DONE
- Reached max iterations
- User interrupt (Ctrl+C)

**Cleanup on exit:**

- Stop database containers (if started)
- Kill any child processes

### 3.3 `ralph monitor`

Real-time status display showing progress and current activity.

**Displays:**

- Ralph status (RUNNING / BETWEEN TASKS / STOPPED)
- Progress bar with task counts (done/total, percentage)
- Current task ID and title
- Phase timeline for the active iteration (Boot → Red → Green → Verify → Commit)

**Options:**

- `-w, --watch` — continuous mode, refresh every N seconds (default: 5)
- `-i, --interval <seconds>` — refresh interval for watch mode

### 3.4 `ralph kill`

Force-stop ralph and all child processes (claude sessions, watchers, etc.).

**Behavior:**

- Find all ralph-related processes
- Kill them (process tree)
- Report what was killed or "Ralph is not running"

### 3.5 `ralph milestones`

Generate `docs/MILESTONES.md` — a quick-scan index of tasks grouped by milestone.

**Output format:**

```markdown
# Milestones

## N — Milestone Name ($total_cost)

- [x] T-NNN: Title — $cost
- [ ] T-NNN: Title
```

Includes per-milestone cost rollup and grand total.

### 3.6 `ralph shas`

Backfill or correct commit SHAs in task files.

**Behavior:**

- Scan all DONE tasks
- Find the matching `T-NNN:` commit in git log
- Update the `Commit` field if missing or incorrect
- Report changes

### 3.7 `ralph cost`

Calculate and display token usage and estimated cost from ralph log files.

**Modes:**

- `ralph cost <logfile>` — single log file
- `ralph cost --task T-NNN` — all logs for a specific task
- `ralph cost --all` — all logs, grouped by task
- `ralph cost --total` — grand total only
- `ralph cost --update-tasks` — write cost into each DONE task file

**Output:** tabular display with columns: Input tokens, Cache Write, Cache Read, Output tokens, Cost.

## 4. Log Files

Ralph stores iteration logs in `.ralph-logs/` as JSONL files.

- Naming: `T-NNN-YYYYMMDD-HHMMSS.jsonl`
- Content: Claude's JSON stream output (tool calls, text, usage, errors)
- Used by `ralph cost` and `ralph monitor` for analysis

## 5. The Boot Prompt

Each iteration sends a structured prompt to Claude that instructs it to:

1. Scan task files and find the next eligible task
2. Read the referenced PRD sections
3. Implement using red/green TDD
4. Run the quality check command after each layer
5. Commit with message format `T-NNN: description`
6. Update the task file in the same commit
7. Complete ONE task, then stop

The boot prompt is critical to ralph's operation — it encodes the methodology rules that each stateless Claude session follows.

## 6. Quality Gates

Ralph enforces these quality gates via the boot prompt:

- All tests pass
- Quality check command passes (lint, format, typecheck, build, test)
- Every line of production code exercised by a test
- No code smells (dead code, TODOs, duplication)
- No security vulnerabilities
- One commit per task, task file update in the same commit

## 7. Git Safety

- Auto-push enabled by default (`--no-push` to disable)
- Never discard staged changes — only unstaged changes from crashed iterations
- Clean shutdown on Ctrl+C

## 8. Non-Goals

- Ralph does NOT manage or install Claude Code — it assumes `claude` CLI is available
- Ralph does NOT handle CI/CD — it's a local development tool
- Ralph does NOT require a database — DB setup is project-specific
- Ralph does NOT prescribe a specific language or framework — it works with any stack
