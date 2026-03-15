---
title: Methodology
description: The Ralph Methodology — stateless boot, PRD-driven development, red/green/verify cycle.
---

The Ralph Methodology is a structured approach to AI-assisted development. Instead of ad-hoc prompting, you define requirements in a PRD, decompose them into tasks, and let ralph drive your AI agent through a disciplined TDD cycle.

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

Each iteration is **stateless** — the agent boots from disk, reads the current task, implements it, and commits. No persistent memory, no context window accumulation.

## Artifacts

| Artifact   | Path                  | Purpose                                            |
| ---------- | --------------------- | -------------------------------------------------- |
| PRD        | `docs/PRD.md`         | What to build. Source of truth for requirements.   |
| Task files | `docs/tasks/T-NNN.md` | What to do next. One file per task.                |
| Milestones | `docs/MILESTONES.md`  | Quick-scan index of tasks grouped by milestone.    |
| Config     | `ralph.config.json`   | Project configuration.                             |

## Quality Gates

Every task must pass **all** gates before committing:

- All tests pass
- Quality check command passes (lint, format, typecheck, build, test)
- Every line of production code exercised by a test
- No code smells: no dead code, no commented-out blocks, no TODO/FIXME/HACK, no duplication
- No security vulnerabilities

## Rules

- **Behavioral tests only** — test outcomes, not implementation details
- **One commit per task** — task file update included in the same commit
- **Minimal green** — implement only what failing tests require
- **No scope creep** — if the task is done, commit
- **Verify early and often** — run quality check after each layer, not only at the end

## Stateless Boot

Each iteration starts from scratch. The agent receives a boot prompt containing:

1. The TDD methodology and quality rules
2. Project configuration (language, package manager, etc.)
3. The current task description and PRD content
4. A codebase index of source files and exports
5. Retry context from any previous failed attempt

This means the agent always works from current state — no stale context, no accumulated drift.
