---
title: Quick Start
description: Go from zero to your first completed task in under 60 seconds.
---

## Prerequisites

- Node.js 20+
- An AI coding agent CLI installed (e.g., [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview))

## 1. Initialize Your Project

```bash
pnpm dlx @smplcty/ralph init
# or
npx @smplcty/ralph init
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

## 2. Write Your PRD

Edit `docs/PRD.md` with numbered sections describing what to build:

```markdown
## 1. User Authentication

The system must support email/password authentication with JWT tokens.

### 1.1 Registration

Users can register with email and password. Passwords must be hashed with bcrypt.
```

## 3. Create Tasks

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

## 4. Run the Loop

```bash
pnpm dlx @smplcty/ralph loop
# or
npx @smplcty/ralph loop
```

Ralph will:
1. Find the next eligible task (lowest TODO with all dependencies DONE)
2. Build a boot prompt with the task details and PRD content
3. Launch your AI agent in a stateless session
4. The agent implements the task using red/green TDD
5. Quality gates run (lint, format, typecheck, build, test)
6. The agent commits and ralph moves to the next task

## 5. Monitor Progress

In another terminal:

```bash
pnpm dlx @smplcty/ralph monitor -w
# or
npx @smplcty/ralph monitor -w
```

This shows a live dashboard with task progress, current phase, and agent activity.
