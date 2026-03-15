---
title: Writing Tasks
description: Best practices for writing effective task files.
---

Good task files make the difference between a productive ralph session and a frustrating one. Here's how to write tasks that agents can execute efficiently.

## Keep Tasks Small

Each task should be completable in a single iteration (10-20 minutes of agent time). If a task needs more than 5 files or touches multiple subsystems, split it.

```markdown
# Bad: too broad
# T-010: Implement authentication system

# Good: focused
# T-010: Implement password hashing utility
# T-011: Implement registration endpoint
# T-012: Implement login endpoint
# T-013: Implement JWT token middleware
```

## Order Dependencies Carefully

Tasks execute in order — the lowest-numbered eligible TODO runs first. Structure dependencies so foundational work comes first:

```markdown
# T-001: Set up project structure
# T-002: Implement database connection (depends: T-001)
# T-003: Implement user model (depends: T-002)
# T-004: Implement registration (depends: T-003)
```

Use `none` for tasks with no dependencies.

## Use the Touches Field

The `Touches` field tells the agent which files to focus on, reducing exploration time:

```markdown
- **Touches**: `src/auth/register.ts`, `src/auth/hash.ts`
```

This is especially valuable as the codebase grows — without it, the agent may spend turns reading unrelated files.

## Write Useful Hints

The `Hints` section gives the agent implementation guidance:

```markdown
## Hints

- Follow the pattern in `src/auth/login.ts` for request validation
- Use the `hashPassword` helper from `src/auth/hash.ts`
- The User model is already defined in `src/models/user.ts`
```

Good hints prevent the agent from reinventing patterns that already exist in the codebase.

## Be Specific in Descriptions

Vague descriptions lead to vague implementations:

```markdown
# Bad
Implement the settings page.

# Good
Create a GET /api/settings endpoint that returns the authenticated user's
settings (theme, notification preferences, timezone). Settings are stored
in the `user_settings` table with a foreign key to `users.id`.
```

## Specify What Gets Produced

The `Produces` section sets expectations:

```markdown
## Produces

- `src/auth/register.ts` — registration endpoint handler
- `src/auth/__tests__/register.test.ts` — behavioral tests
```

## Complexity Hints

For tasks that need more runway, set complexity explicitly:

```markdown
- **Complexity**: Heavy
```

This gives the agent more turns (125 vs. 50) and a longer timeout (1200s vs. 600s).
