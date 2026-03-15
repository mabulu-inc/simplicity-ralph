---
title: shas
description: Backfill commit SHAs into task metadata.
---

```bash
pnpm dlx @mabulu-inc/ralph shas
# or
npx @mabulu-inc/ralph shas
```

Backfill or correct commit SHAs in task files.

## Behavior

1. Scans all task files with status `DONE`
2. Searches git log for commits matching `T-NNN:` in the message
3. Updates the `Commit` field if missing or incorrect
4. Reports changes made

This is run automatically by `ralph loop` after each iteration, but you can run it manually to fix missing SHAs.
