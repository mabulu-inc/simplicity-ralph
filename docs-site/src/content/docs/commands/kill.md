---
title: kill
description: Force-stop ralph and all child processes.
---

```bash
pnpm dlx @mabulu-inc/ralph kill
# or
npx @mabulu-inc/ralph kill
```

Force-stop ralph and all child processes (agent sessions, watchers, etc.).

## Behavior

1. Finds all ralph-related processes using PID file tracking
2. Terminates the full process tree (agent, compilers, test runners)
3. Reports what was killed

If ralph is not running, reports "Ralph is not running."

## When to Use

- The agent is stuck or looping
- You need to stop ralph immediately (alternative to Ctrl+C)
- A crashed iteration left orphan processes
