---
title: Tasks
description: Task file format, status values, dependencies, and eligibility rules.
---

Tasks are ralph's unit of work. Each task is a Markdown file in `docs/tasks/` with structured metadata and a description.

## File Format

```markdown
# T-NNN: Short title

- **Status**: TODO
- **Milestone**: 1 — Authentication
- **Depends**: T-001, T-002
- **PRD Reference**: §3.2
- **Touches**: `src/auth/login.ts`, `src/auth/middleware.ts`
- **Complexity**: Standard

## Description

What to implement and why.

## Hints

Implementation guidance — patterns to follow, helpers to reuse, pitfalls to avoid.

## Produces

- `src/auth/login.ts`
- Tests
```

## Status Values

| Status        | Meaning                                        |
| ------------- | ---------------------------------------------- |
| `TODO`        | Ready to be picked up (if dependencies are met) |
| `IN-PROGRESS` | Currently being worked on by an agent          |
| `DONE`        | Completed and committed                        |
| `BLOCKED`     | Cannot proceed (has a `## Blocked` section)     |
| `SKIPPED`     | Intentionally skipped                          |

## Task Eligibility

A task is **eligible** when:

1. Its status is `TODO`
2. All tasks listed in `Depends` have status `DONE`
3. It has no `## Blocked` section

The **next task** is always the lowest-numbered eligible task.

## Completion Metadata

When a task is completed, ralph updates these fields in the same commit:

- `Status` → `DONE`
- `Completed` → timestamp with duration (e.g., `2025-01-15 14:30 (8m duration)`)
- `Commit` → the commit SHA
- A `## Completion Notes` section is added with a summary

## Complexity Tiers

Tasks can specify a complexity tier that controls timeout and max-turns scaling:

| Tier     | Criteria                                       | Max Turns | Timeout |
| -------- | ---------------------------------------------- | --------- | ------- |
| Light    | 0–1 deps, 1–2 produces, no integration keyword | 50        | 600s    |
| Standard | 2–3 deps OR 3–4 produces                       | 75        | 900s    |
| Heavy    | 4+ deps OR 5+ produces OR integration keyword  | 125       | 1200s   |

Complexity is auto-detected from the task file unless explicitly set.

## Dependencies

Dependencies are listed in the `Depends` field as comma-separated task IDs:

```markdown
- **Depends**: T-001, T-002
```

A task won't be picked up until all its dependencies are `DONE`. Use `none` for tasks with no dependencies.

## Touches Field

The optional `Touches` field lists files the task will read or modify:

```markdown
- **Touches**: `src/auth/login.ts`, `src/auth/middleware.ts`
```

This helps the agent focus on relevant files during the boot phase instead of exploring the entire codebase.
