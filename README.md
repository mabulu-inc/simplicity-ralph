# @smplcty/ralph

Stateless, PRD-driven AI development loop — your AI coding agent builds your project one task at a time using red/green TDD, automatically.

## Why Ralph?

- **Automated TDD** — every task goes through red/green/verify before committing
- **Task-driven development** — decompose your PRD into task files, ralph does the rest
- **Multi-agent support** — works with Claude Code, Gemini CLI, Codex CLI, Continue, and Cursor
- **9 agent roles** — PM, Architect, Security, SDET, and more review every iteration
- **Cost tracking** — token usage and cost breakdowns per task and milestone
- **Stateless** — each iteration boots from disk, no persistent agent state to corrupt

## How It Works

Ralph follows a simple workflow: **PRD → Tasks → Loop**.

1. **You write a PRD** — a product requirements document that describes what to build, broken into numbered sections.
2. **You decompose the PRD into task files** — small, ordered units of work that reference PRD sections.
3. **Ralph runs the loop** — it picks up the next eligible task, launches an AI coding agent, and the agent implements the task using red/green TDD. When it commits, ralph moves to the next task.

Each iteration is stateless: the agent boots from disk, reads the task, writes failing tests, implements the minimum to pass, runs quality checks, commits, and stops. No memory carries over between tasks — the PRD and task files are the source of truth.

Each iteration is also a structured collaboration between **9 specialized agent roles** — Product Manager, System Architect, Security Engineer, UX/UI Designer, Frontend & Backend Engineers, DevOps/SRE, SDET, Technical Lead, and DBA/Data Engineer. Each role contributes focused expertise at specific phases (Boot and Verify are gate phases requiring explicit approval). Run `ralph show roles` to see the full role definitions and participation rules.

## Getting Started

### 1. Initialize your project

```bash
npx @smplcty/ralph init
```

This interactive command scaffolds everything ralph needs:

- `docs/PRD.md` — a skeleton PRD for you to fill in with your requirements
- `docs/tasks/T-000.md` — an initial bootstrap task
- `docs/prompts/rules.md` — project-specific rules (e.g., "all code goes under `src/`")
- `ralph.config.json` — project configuration (language, test framework, quality check command, etc.)
- Agent instructions file (e.g., `.claude/CLAUDE.md`) — a minimal stub pointing to the methodology

Ralph's built-in prompts, roles, and methodology are used directly from the package at runtime — they are not copied into your project. This means you always get the latest version when you upgrade ralph.

### 2. Write your PRD

Open `docs/PRD.md` and describe what you're building. Use numbered sections — tasks will reference these by section number (e.g., `§3.2`). The PRD doesn't need to be formal; it needs to be specific enough that an AI agent can implement it.

```markdown
# My Project — Product Requirements Document

## 1. User Authentication

Users can sign up with email/password and log in...

### 1.1 Registration

...

### 1.2 Login

...
```

### 3. Create task files

Each task is a Markdown file in `docs/tasks/` with a specific format:

```markdown
# T-001: Implement user registration endpoint

- **Status**: TODO
- **Milestone**: 1 — Authentication
- **Depends**: T-000
- **PRD Reference**: §1.1
- **Complexity**: standard

## Description

Build the POST /api/register endpoint that accepts email and password,
validates input, hashes the password, and stores the user record.

## AC

- [ ] POST /api/register returns 201 with valid input
- [ ] Returns 400 for missing or invalid fields
- [ ] Passwords are hashed before storage
```

Key fields:

- **Status** — `TODO` or `DONE`. Ralph picks up `TODO` tasks.
- **Depends** — other tasks that must be `DONE` first. Use `none` if there are no dependencies.
- **PRD Reference** — which PRD section this task implements (e.g., `§1.1`). Ralph injects the referenced section content into the agent's prompt automatically.
- **Complexity** — `light`, `standard`, or `heavy`. Controls how many agent turns and how much time the loop allocates. If omitted, ralph estimates based on the task content.

### 4. Run the loop

```bash
npx @smplcty/ralph loop
```

Ralph finds the lowest-numbered eligible task (status `TODO`, all dependencies `DONE`) and launches your configured AI agent with a boot prompt that includes the task description, referenced PRD section, and project rules. The agent then:

1. **Boot** — reads the task file and referenced PRD sections
2. **Red** — writes failing tests based on the acceptance criteria
3. **Green** — implements the minimum code to make tests pass
4. **Verify** — runs the quality check command (lint, format, typecheck, build, test)
5. **Commit** — commits with the format `T-NNN: description` and marks the task `DONE`

After the commit, ralph moves to the next eligible task. This continues until all tasks are done, the iteration limit is reached, or you press Ctrl+C.

Common options:

```bash
ralph loop --verbose          # Stream agent output to terminal
ralph loop --iterations 5     # Stop after 5 tasks
ralph loop --no-push          # Don't auto-push after iterations
ralph loop --dry-run          # Print config and exit
```

### 5. Monitor progress

In a separate terminal:

```bash
npx @smplcty/ralph monitor --watch
```

This shows a live dashboard with the current task, phase progress, and recent agent output.

## Commands

| Command      | Description                                               |
| ------------ | --------------------------------------------------------- |
| `init`       | Interactive project bootstrapper — scaffolds ralph files  |
| `loop`       | Main AI development loop — picks tasks and builds         |
| `monitor`    | Real-time progress dashboard with phase tracking          |
| `show`       | Inspect effective prompts, roles, and methodology         |
| `task`       | Scaffold a new task file with auto-numbered ID            |
| `review`     | Review task timeline, diagnose failures, project coaching |
| `migrate`    | Migrate legacy prompt files to the extension model        |
| `retry`      | Reset blocked tasks so they can be retried from scratch   |
| `milestones` | Generate milestone summary from task files                |
| `cost`       | Token usage and cost breakdown                            |
| `shas`       | Backfill commit SHAs into completed task files            |
| `kill`       | Stop a running ralph loop process                         |

### Global Flags

| Flag              | Description            |
| ----------------- | ---------------------- |
| `--version`, `-V` | Print version and exit |
| `--help`, `-h`    | Show help text         |

## Customizing Ralph

Ralph's built-in prompts, roles, and methodology are always current from the package — you never need to manage or update them. To customize ralph's behavior, you create optional **extension files** in `docs/prompts/` that are appended to the built-in content:

| Extension File                | Extends                   | Purpose                                                    |
| ----------------------------- | ------------------------- | ---------------------------------------------------------- |
| `docs/prompts/system.md`      | Built-in system prompt    | Additional system-level instructions                       |
| `docs/prompts/boot.md`        | Built-in boot prompt      | Additional boot-level content                              |
| `docs/prompts/methodology.md` | Built-in methodology      | Additional methodology guidance                            |
| `docs/prompts/roles.md`       | Built-in role definitions | Role overrides, additions, and disables                    |
| `docs/prompts/rules.md`       | (standalone)              | Project-specific rules — the one file `ralph init` creates |

Extension content is **appended after** built-in content. Your extensions are never overwritten by ralph — they survive upgrades. Use `ralph show` to inspect the effective merged content at any time.

### Adding a custom role

Create `docs/prompts/roles.md`:

```markdown
## Add: Compliance Officer

- **Focus**: Regulatory compliance
- **Responsibility**: Reviews all data handling for GDPR/HIPAA compliance. Validates that PII is encrypted at rest and in transit.
- **Participates**: Boot, Verify
```

Run `ralph show roles` to verify the new role appears alongside the 9 built-in roles.

## API Reference

Ralph's task file format and extension mechanism are **stable public API contracts** with backward-compatibility guarantees. New fields and extension files may be added, but existing ones will not change meaning or be removed without a major version bump.

### Task File Fields

| Field           | Format                            | Required |
| --------------- | --------------------------------- | -------- |
| `Status`        | `TODO` \| `DONE` \| `BLOCKED`     | Yes      |
| `Milestone`     | `N — Name`                        | Yes      |
| `Depends`       | Comma-separated `T-NNN` or `none` | Yes      |
| `PRD Reference` | `§N.N` references                 | Yes      |
| `Complexity`    | `light` \| `standard` \| `heavy`  | No       |
| `Touches`       | Comma-separated file paths        | No       |
| `Hints`         | (section body)                    | No       |
| `Model`         | Model identifier string           | No       |
| `Roles`         | Comma-separated role names        | No       |
| `Completed`     | `YYYY-MM-DD HH:MM (Nm duration)`  | No       |
| `Commit`        | 40-character SHA                  | No       |
| `Cost`          | `$N.NN`                           | No       |

Unknown fields are ignored and preserved. Custom sections (e.g., `## Security Considerations`) are included in the task body sent to the agent.

### Extension Files

| File                            | Merge Behavior                     | Description                          |
| ------------------------------- | ---------------------------------- | ------------------------------------ |
| `docs/prompts/system.md`        | Appended to built-in system prompt | Additional system-level instructions |
| `docs/prompts/boot.md`          | Appended to built-in boot prompt   | Additional boot-level content        |
| `docs/prompts/methodology.md`   | Appended to built-in methodology   | Additional methodology guidance      |
| `docs/prompts/rules.md`         | Injected as `{{project.rules}}`    | Project-specific rules               |
| `docs/prompts/roles.md`         | Merged with built-in roles         | Override, Add, Disable directives    |
| `docs/prompts/task-template.md` | Replaces built-in task scaffold    | Custom template for `ralph task`     |

Extension files are always optional, never overwritten by ralph, and appended (not replaced). Template variables (`{{task.id}}`, `{{config.language}}`, etc.) work in extension files.

For full details, see the [Task File API Reference](https://mabulu-inc.github.io/simplicity-ralph/reference/task-file-api/) and [Extension API Reference](https://mabulu-inc.github.io/simplicity-ralph/reference/extension-api/) on the docs site.

## Requirements

- Node.js 20+

## Documentation

Full documentation: [https://mabulu-inc.github.io/simplicity-ralph/](https://mabulu-inc.github.io/simplicity-ralph/)
