---
title: Quick Start
description: Go from zero to your first completed task in under 60 seconds.
---

## Prerequisites

- Node.js 20+
- An AI coding agent CLI installed (e.g., [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview))
- A GitHub personal access token with `read:packages` scope

## 1. Configure Registry

`@mabulu-inc/ralph` is published to GitHub Packages. Add to your `.npmrc`:

```
@mabulu-inc:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

## 2. Initialize Your Project

```bash
pnpm dlx @mabulu-inc/ralph init
# or
npx @mabulu-inc/ralph init
```

Ralph will prompt you for:
- Project name
- Language (TypeScript, Python, Go, etc.)
- Package manager
- Test framework
- Quality check command
- AI agent to use

This scaffolds:
- `docs/PRD.md` — your product requirements document
- `docs/RALPH-METHODOLOGY.md` — the methodology reference
- `docs/tasks/T-000.md` — your first infrastructure task
- `docs/prompts/boot.md` — the boot prompt template
- `docs/prompts/rules.md` — project-specific rules
- `ralph.config.json` — project configuration
- Agent instructions file (e.g., `.claude/CLAUDE.md`)

## 3. Write Your PRD

Edit `docs/PRD.md` with numbered sections describing what to build:

```markdown
## 1. User Authentication

The system must support email/password authentication with JWT tokens.

### 1.1 Registration

Users can register with email and password. Passwords must be hashed with bcrypt.
```

## 4. Create Tasks

Create task files in `docs/tasks/` that reference PRD sections:

```markdown
# T-001: Implement user registration

- **Status**: TODO
- **Milestone**: 1 — Authentication
- **Depends**: T-000
- **PRD Reference**: §1.1

## Description

Create a registration endpoint that accepts email and password,
validates input, hashes the password, and stores the user.

## Produces

- `src/auth/register.ts`
- Tests
```

## 5. Run the Loop

```bash
pnpm dlx @mabulu-inc/ralph loop
# or
npx @mabulu-inc/ralph loop
```

Ralph will:
1. Find the next eligible task (lowest TODO with all dependencies DONE)
2. Build a boot prompt with the task details and PRD content
3. Launch your AI agent in a stateless session
4. The agent implements the task using red/green TDD
5. Quality gates run (lint, format, typecheck, build, test)
6. The agent commits and ralph moves to the next task

## 6. Monitor Progress

In another terminal:

```bash
pnpm dlx @mabulu-inc/ralph monitor -w
# or
npx @mabulu-inc/ralph monitor -w
```

This shows a live dashboard with task progress, current phase, and agent activity.
