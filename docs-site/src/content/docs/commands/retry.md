---
title: retry
description: Reset blocked tasks so they can be retried from scratch.
---

```bash
pnpm dlx @smplcty/ralph retry T-005
# or
npx @smplcty/ralph retry T-005
```

Reset one or more BLOCKED tasks so they can be retried from scratch. Logs are preserved but moved out of the retry-count path.

## Usage

```bash
ralph retry T-005 [T-006 ...]
```

## Behavior

1. Validates that each task has status `BLOCKED` — errors on TODO or DONE tasks
2. Sets `Status` back to `TODO` and removes the `Blocked reason` field
3. Moves all `.ralph-logs/T-NNN-*.jsonl` files into `.ralph-logs/T-NNN-resets/` (accumulates across multiple resets)
4. Reports what was reset

If a task is already TODO with no logs, it's a no-op with a message.

## When to Use

- A task was blocked after exceeding the retry limit but has been redesigned
- A dependency was enhanced or fixed, making a previously blocked task viable
- The cost cap was hit but you've optimized the task or raised the limit
