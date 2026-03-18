# Ralph Methodology

Stateless, PRD-driven development automated by Claude Code.

## How It Works

1. Write a **PRD** (`docs/PRD.md`) — numbered sections, testable requirements
2. Decompose into **task files** (`docs/tasks/T-NNN.md`) — one per feature, with dependencies
3. Run the ralph loop — it launches Claude Code sessions, each picking up the next task

Each iteration is stateless: boot from disk, find next task, red/green TDD, commit, update task file.

## Artifacts

| Artifact   | Path                  | Purpose                                                               |
| ---------- | --------------------- | --------------------------------------------------------------------- |
| PRD        | `docs/PRD.md`         | What to build. Source of truth for requirements.                      |
| Task files | `docs/tasks/T-NNN.md` | What to do next. One file per task, status tracked inline.            |
| Milestones | `docs/MILESTONES.md`  | Quick-scan index of tasks grouped by milestone. Not authoritative.    |
| CLAUDE.md  | `.claude/CLAUDE.md`   | Project config. References this methodology + project-specific setup. |

## Task File Format

```markdown
# T-NNN: Short title

- **Status**: TODO | DONE
- **Milestone**: N — Name
- **Depends**: T-XXX, T-YYY (or "none")
- **PRD Reference**: §N.N
- **Complexity**: light | standard | heavy
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

### Complexity guide

Set **Complexity** when creating a task. The loop uses it to allocate agent turns and timeout.

| Tier       | Turns | Timeout | Use when…                                                             |
| ---------- | ----- | ------- | --------------------------------------------------------------------- |
| `light`    | 50    | 600s    | Single-file change, isolated unit, no cross-cutting concerns          |
| `standard` | 75    | 900s    | Touches 2-3 files/packages, moderate test surface                     |
| `heavy`    | 125   | 1200s   | Cross-package refactor, infrastructure overhaul, large test migration |

If omitted, the loop falls back to an automated heuristic (less accurate).

## The Loop

```
┌─ Boot ──────────────────────────────────────┐
│  Scan docs/tasks/T-*.md                     │
│  Find lowest TODO with all Depends DONE     │
│  Read PRD sections from task's PRD Reference│
├─ Execute ───────────────────────────────────┤
│  RED:   Write failing behavioral tests      │
│  GREEN: Implement minimum to pass           │
│  VERIFY: Run quality check                  │
├─ Complete ──────────────────────────────────┤
│  Commit: "T-NNN: short description"         │
│  Update task file: Status→DONE, SHA, notes  │
└─────────────────────────────────────────────┘
```

## Quality Gates

Every task must pass ALL gates before committing. No exceptions.

- All tests pass
- Quality check command passes
- Every line of production code must be exercised by a test
- No code smells: no dead code, no commented-out blocks, no TODO/FIXME/HACK, no duplication
- No security vulnerabilities

## Commit Discipline

Planning artifacts and implementation have separate commit flows:

- **PRD changes** — commit before implementation. The PRD is the spec; it should be in place before the agent acts on it.
- **New task files** — commit when you create them. Don't leave them unstaged for the loop to discard.
- **Task status update** — committed by the agent in the same commit as the implementation (Status → DONE, SHA, notes).

In short: humans commit the plan, the agent commits the work.

## Rules

- **Behavioral tests only** — test outcomes, not implementation details
- **One commit per task** — task file update included in the same commit
- **Minimal green** — implement only what failing tests require
- **No scope creep** — if the task is done, commit
- **All checks pass** — quality check must succeed before committing
- **Verify early and often** — run quality check after each layer, not only at the end

## Upgrading Ralph

After upgrading `@smplcty/ralph`, run `ralph update` to refresh methodology docs and prompt templates. This regenerates ralph-owned files while preserving user-authored content (`docs/prompts/rules.md`, `docs/PRD.md`, task files).
