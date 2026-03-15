---
title: monitor
description: Real-time progress dashboard with phase tracking and activity indicators.
---

```bash
pnpm dlx @mabulu-inc/ralph monitor -w
# or
npx @mabulu-inc/ralph monitor -w
```

Real-time status display showing progress and current activity.

## Display

The monitor shows:

- **Ralph status** — RUNNING / BETWEEN TASKS / STOPPED
- **Progress bar** — task counts (done/total, percentage)
- **Current task** — ID and title
- **Phase timeline** — per-phase durations with live timer on the active phase
  ```
  ● Boot (45s) → ● Red (1m 12s) → ● Green (2m 30s) → ○ Verify → ○ Commit
  ```
- **Last output** — most recent agent text with staleness indicator
  ```
  Last output (2m 13s ago): Let me verify the tests fail.
  ```
- **Activity** — current tool call when no text output exists
  ```
  Activity: Bash (14s ago)
  ```

## Options

| Flag                       | Description                    | Default |
| -------------------------- | ------------------------------ | ------- |
| `-w, --watch`              | Continuous mode                | off     |
| `-i, --interval <seconds>` | Refresh interval in watch mode | `1`     |

## Watch Mode

With `-w`, the monitor clears the screen before each refresh, creating a live dashboard that updates in place. The default 1-second refresh interval provides responsive phase timers.

Without `-w`, the monitor prints a single snapshot and exits.
