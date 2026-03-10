# Ralph Methodology

Stateless, PRD-driven development automated by Claude Code.

## How It Works

1. Write a **PRD** (`docs/PRD.md`) — numbered sections, testable requirements
2. Decompose into **task files** (`docs/tasks/T-NNN.md`) — one per feature, with dependencies
3. Run **`pnpm ralph`** — it loops Claude Code sessions, each one picking up the next task

Each iteration is stateless: boot from disk, find next task, red/green TDD, commit, update task file.

## Artifacts

| Artifact   | Path                  | Purpose                                                               |
| ---------- | --------------------- | --------------------------------------------------------------------- |
| PRD        | `docs/PRD.md`         | What to build. Source of truth for requirements.                      |
| Task files | `docs/tasks/T-NNN.md` | What to do next. One file per task, status tracked inline.            |
| Milestones | `docs/MILESTONES.md`  | Quick-scan index of tasks grouped by milestone. Not authoritative.    |
| CLAUDE.md  | `.claude/CLAUDE.md`   | Project config. References this methodology + project-specific setup. |
| ralph.sh   | `scripts/ralph.sh`    | The automation loop. Runs Claude Code headlessly.                     |

## Task File Format

```markdown
# T-NNN: Short title

- **Status**: TODO | DONE
- **Milestone**: N — Name
- **Depends**: T-XXX, T-YYY (or "none")
- **PRD Reference**: §N.N
- **Completed**: YYYY-MM-DD HH:MM (Nm duration) ← added on completion
- **Commit**: <SHA> ← added on completion

## Description

What to implement and why.

## Produces

- `path/to/file.ts`
- Tests

## Completion Notes ← added on completion

What was done. Test count.
```

## The Loop

```
┌─ Boot ──────────────────────────────────────┐
│  Scan docs/tasks/T-*.md                     │
│  Find lowest TODO with all Depends DONE     │
│  Read PRD sections from task's PRD Reference│
├─ Execute ───────────────────────────────────┤
│  RED:   Write failing behavioral tests      │
│  GREEN: Implement minimum to pass           │
│  VERIFY: pnpm check (lint+format+types+test)│
├─ Complete ──────────────────────────────────┤
│  Commit: "T-NNN: short description"         │
│  Update task file: Status→DONE, SHA, notes  │
└─────────────────────────────────────────────┘
```

## Quality Gates

Every task must pass ALL gates before committing. No exceptions.

### Automated (`pnpm check`)

```
pnpm check = lint → format → typecheck → build → test:coverage
```

Pre-commit hooks (husky + lint-staged) enforce lint and format on every commit — including ralph's.

T-000 sets up: ESLint, Prettier, husky, lint-staged, coverage config, and `pnpm check`.

### Code quality (enforced during implementation)

- **Every line of production code must be exercised by a test.** This proves red/green was followed. No untested code ships.
- **No code smells.** No dead code, no commented-out blocks, no TODO/FIXME/HACK left behind, no duplicated logic, no overly complex functions. If a smell is introduced, fix it before committing.
- **No security vulnerabilities.** No SQL injection, no command injection, no unsanitized user input, no hardcoded secrets. Follow OWASP top 10. If a vulnerability is found in existing code, fix it immediately.
- **No outdated or deprecated dependencies.** Use current, maintained versions. If a deprecated dep is unavoidable, document the reason and a migration plan in a `## Deprecated Deps` section in the task file.

## Rules

- **Behavioral tests only** — test outcomes against real infrastructure, never mock databases
- **One commit per task** — no Claude attribution in commit messages. The task file update (Status→DONE, SHA, notes) MUST be included in the same commit as the code — never split into a separate commit.
- **Minimal green** — implement only what failing tests require
- **No scope creep** — if the task is done, commit. Don't improve adjacent code.
- **No pushing** — `scripts/ralph.sh` handles git push after each iteration
- **All checks pass** — `pnpm check` must succeed before committing
- **Verify early and often** — run `pnpm check` after implementing each layer (e.g. types, then planner, then tests), not only at the end. Catching errors early avoids wasting an entire iteration on code that doesn't compile or pass. A task that spans 6+ files MUST verify at least once mid-implementation.
- **Use dedicated tools, not shell equivalents** — use the Read tool to read files, not `cat`/`head`/`tail`. Use Grep to search, not `grep`. Shell commands dump large outputs into context and waste tokens. Reserve Bash for commands that have no dedicated tool (git, pnpm, docker).

---

## Detailed Reference

### Starting a New Project

1. Write `docs/PRD.md` with numbered sections covering all features
2. Create `docs/tasks/` with T-000 as infrastructure bootstrap
3. Decompose remaining PRD sections into T-001+ with explicit dependencies
4. Create `.claude/CLAUDE.md`:

```markdown
# PROJECT — Claude Code Instructions

## Methodology

Follow the Ralph Methodology defined in `docs/RALPH-METHODOLOGY.md`.

## Project-Specific Config

- **Language**: TypeScript / Python / etc.
- **Package manager**: pnpm / npm / etc.
- **Testing framework**: Vitest / pytest / etc.
- **Test command**: `pnpm test`
- **Database**: PostgreSQL via Docker on port XXXXX
```

5. Copy `scripts/ralph.sh` and `scripts/ralph-kill.sh` into the project
6. Add scripts to `package.json`: `"ralph": "bash scripts/ralph.sh"`, `"ralph:kill": "bash scripts/ralph-kill.sh"`
7. Run: `pnpm ralph`

### Task Design

- **T-000 is always infrastructure**: quality tooling (ESLint, Prettier, husky, lint-staged, coverage), `pnpm check` script, Docker if needed
- **Size**: One task = one test file + one commit. If it needs multiple test files, split it.
- **Dependencies**: Explicit in the `Depends` field. Tasks without unmet deps can run.
- **Milestones**: Group related tasks. Numbering within a milestone implies build order.
- **PRD traceability**: Every task references specific PRD sections via `§N.N`

### Gap Analysis

After initial task decomposition, audit coverage by:

1. Walking each PRD section and checking it has at least one task
2. Running the system and noting untested behaviors
3. Adding new task files (next available T-NNN) with proper dependencies

### Blocker Handling

When a task can't be completed:

1. Add a `## Blocked` section to the task file explaining why
2. Leave Status as TODO
3. The loop automatically skips it (unmet deps or manual block) and picks the next eligible task

### ralph.sh Behavior

The shell script that drives the loop:

- **Pre-flight**: Checks for `claude` CLI, `docker`, and `docs/tasks/` directory
- **Database**: Starts Docker Compose before each iteration, tears down on exit
- **Clean slate**: Discards unstaged changes from crashed iterations on startup
- **Iteration**: Launches `claude --print` with a boot prompt, monitors progress via JSON stream
- **Timeout**: Kills iterations exceeding the limit (default 15min), discards partial work
- **Push**: Auto-pushes commits to origin after each successful iteration
- **Logging**: Each iteration logs to `.ralph-logs/T-NNN-TIMESTAMP.jsonl`

Usage:

```bash
pnpm ralph              # 10 iterations (default)
pnpm ralph -- -n 0      # unlimited — run until all tasks DONE
pnpm ralph -- -n 5 -v   # 5 iterations, verbose (stream output)
pnpm ralph -- -t 600    # 10-minute timeout per iteration
pnpm ralph -- --dry-run # print config and exit
pnpm ralph:kill         # force-stop ralph and all child processes
```
