---
title: milestones
description: Generate milestone summaries with cost breakdowns.
---

```bash
pnpm dlx @mabulu-inc/ralph milestones
# or
npx @mabulu-inc/ralph milestones
```

Generates `docs/MILESTONES.md` — a quick-scan index of tasks grouped by milestone.

## Output Format

```markdown
# Milestones

## 1 — Authentication ($12.45)

- [x] T-001: User registration — $3.20
- [x] T-002: Login endpoint — $4.15
- [ ] T-003: Password reset

## 2 — API ($8.30)

- [x] T-004: Profile endpoint — $8.30
- [ ] T-005: Settings endpoint
```

Includes per-milestone cost rollup and a grand total at the bottom.
