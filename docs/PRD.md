# @simplicity/ralph — Product Requirements Document

A CLI tool that implements the Ralph Methodology: stateless, PRD-driven AI development automated by AI coding agents.

Any project can `npx @simplicity/ralph init` to bootstrap, then `ralph loop` to build.

## 1. Task File Format

Ralph's unit of work is a **task file** (`docs/tasks/T-NNN.md`). Each file has:

```markdown
# T-NNN: Short title

- **Status**: TODO | DONE
- **Milestone**: N — Name
- **Depends**: T-XXX, T-YYY (or "none")
- **PRD Reference**: §N.N
- **Touches**: `path/to/file.ts`, `path/to/other.ts` (optional — files the task will read or modify)
- **Model**: (optional — overrides project default, e.g., `claude-opus-4-20250514`)
- **Completed**: YYYY-MM-DD HH:MM (Nm duration)
- **Commit**: <SHA>
- **Cost**: $N.NN

## Description

What to implement and why.

## Hints

(Optional) Implementation guidance for the agent — e.g., which existing patterns to follow, which helpers to reuse, known pitfalls to avoid. Included verbatim in the boot prompt to reduce exploration time.

## Produces

- `path/to/file.ts`
- Tests
```

### 1.1 Task Eligibility

A task is **eligible** when:

- Its status is `TODO`
- All tasks listed in `Depends` have status `DONE`
- It has no `## Blocked` section

The **next task** is the lowest-numbered eligible task.

### 1.2 Task Completion

When a task is completed, update in the same commit:

- `Status` → `DONE`
- `Completed` → timestamp with duration
- `Commit` → the commit SHA
- Add `## Completion Notes` section

## 2. Project Configuration

Ralph reads project configuration from a `ralph.config.json` file at the project root. This is the single source of truth for all structured config — agent instructions files contain only a project goal and methodology pointer, not config values.

### 2.1 Required Config Fields

- **Language** — e.g., TypeScript, Python, Go
- **Package manager** — e.g., pnpm, npm, yarn, pip, cargo
- **Testing framework** — e.g., Vitest, Jest, pytest
- **Quality check** — the command that must pass before committing (e.g., `pnpm check`)
- **Test command** — the command to run tests (e.g., `pnpm test`)
- **Agent** — which AI coding agent to use (default: `claude`). See §10 for supported agents.
- **Model** — which model to use (e.g., `claude-sonnet-4-5-20250514`). If omitted, the agent's default model is used.

### 2.2 Optional Config

- **Database** — if the project uses a database (Docker setup, connection string)
- **File naming** — naming convention (kebab-case, snake_case, etc.)

## 3. Commands

### 3.1 `ralph init`

Interactive project bootstrapper. Prompts for project configuration, then creates the Ralph methodology scaffolding.

**Prompts:**

1. Project name
2. Language (TypeScript, Python, Go, Rust, etc.)
3. Package manager (pnpm, npm, yarn, pip, cargo, etc.)
4. Test framework (Vitest, Jest, pytest, etc.)
5. Check command — required. If none exists, ralph helps set one up.
6. Database (none, PostgreSQL via Docker, etc.)

**Prompts (additional):**

7. AI agent (claude, gemini, codex, continue, cursor — default: auto-detected from installed CLIs, fallback to claude)
8. Model (e.g., `claude-sonnet-4-5-20250514`, `gemini-2.5-pro` — default: agent's default model)

**Creates:**

- `docs/PRD.md` — skeleton PRD with numbered sections to fill in
- `docs/RALPH-METHODOLOGY.md` — full methodology reference
- `docs/tasks/T-000.md` — infrastructure bootstrap task
- `docs/prompts/boot.md` — the default boot prompt template (see §5)
- `docs/prompts/rules.md` — user-editable project-specific rules included in the boot prompt (see §5.9)
- `ralph.config.json` — project configuration including agent selection
- Agent instructions file (e.g., `.claude/CLAUDE.md`, `GEMINI.md`, `AGENTS.md`) — minimal stub with project goal and methodology pointer (no config duplication)

**Behavior:**

- If files already exist, warn and ask before overwriting
- If applicable (Node.js projects), add ralph scripts to `package.json`
- If no check command exists, scaffold one (e.g., add a `check` script to `package.json`)
- Auto-detect installed agent CLIs and default the agent prompt to the first one found (preference order: claude, gemini, codex, continue, cursor). Fall back to claude if none are detected.
- If the selected agent CLI is not installed, warn the user and continue (they may install it later before running `ralph loop`)

### 3.2 `ralph loop`

The main AI development loop. Runs the configured AI coding agent in stateless iterations, each picking up the next eligible task.

**Iteration cycle:**

1. **Pre-flight** — verify the configured agent CLI is installed and on PATH, `docs/tasks/` exists, `docs/prompts/boot.md` exists
2. **Database** — if project has Docker Compose, start containers before each iteration
3. **Clean slate** — discard unstaged changes from crashed iterations
4. **Find next task** — scan task files, select lowest-numbered eligible TODO
5. **Build prompt** — load the boot prompt template from `docs/prompts/boot.md`, interpolate task and config variables
6. **Launch agent** — spawn the configured agent CLI with the rendered prompt and resolved model (task-level model overrides project default; see §10)
7. **Monitor** — track progress via the agent's output stream
8. **Timeout** — kill iterations exceeding the time limit
9. **Commit detection** — after a commit lands, end the iteration (one task per iteration)
10. **Post-iteration** — backfill SHAs, update costs, regenerate milestones, push

**Options:**

- `-n, --iterations <N>` — max iterations (default: 10, 0 = unlimited)
- `-d, --delay <seconds>` — delay between iterations (default: 2)
- `-t, --timeout <seconds>` — max seconds per iteration (default: auto, see Task Complexity Scaling)
- `-m, --max-turns <N>` — max agent turns per iteration (default: auto, see Task Complexity Scaling)
- `-v, --verbose` — stream agent output to terminal
- `--dry-run` — print config and exit
- `--no-push` — don't auto-push after iterations
- `--no-db` — skip database startup
- `--agent <name>` — override the configured agent for this run

**Task Complexity Scaling:**

Before launching each iteration, ralph inspects the target task file and scales `--max-turns` and `--timeout` based on task characteristics. This prevents simple tasks from running away while giving complex tasks enough runway to complete.

Complexity signals (from the task file):

| Signal              | How to detect                                                                   |
| ------------------- | ------------------------------------------------------------------------------- |
| Dependency count    | Number of entries in the `Depends` field                                        |
| Output file count   | Number of items in the `Produces` section                                       |
| Integration keyword | Title or description contains "integration", "end-to-end", "e2e", or "refactor" |

Scaling tiers:

| Tier     | Criteria                                       | Max turns | Timeout |
| -------- | ---------------------------------------------- | --------- | ------- |
| Light    | 0–1 deps, 1–2 produces, no integration keyword | 50        | 600s    |
| Standard | 2–3 deps OR 3–4 produces                       | 75        | 900s    |
| Heavy    | 4+ deps OR 5+ produces OR integration keyword  | 125       | 1200s   |

CLI flags `-m` and `-t` override the auto-scaling when provided explicitly.

**Retry context:**

When a task fails (timeout, non-zero exit, no commit detected), the next attempt for the same task must include context from the failed iteration. Ralph parses the last log file for:

- Last phase reached (Boot, Red, Green, Verify, Commit)
- Last error or failure output
- Files that were modified before failure

This context is injected into the boot prompt so the agent can avoid repeating the same mistake. See §5.6.

**Exit conditions:**

- All tasks are DONE
- Reached max iterations
- User interrupt (Ctrl+C)

**Cleanup on exit:**

- Stop database containers (if started)
- Kill any child processes

### 3.3 `ralph monitor`

Real-time status display showing progress and current activity.

**Displays:**

- Ralph status (RUNNING / BETWEEN TASKS / STOPPED)
- Progress bar with task counts (done/total, percentage)
- Current task ID and title
- Phase timeline for the active iteration (Boot → Red → Green → Verify → Commit)

**Behavior:**

- Watch mode renders as a live dashboard — clear the screen before each refresh so the display updates in place rather than streaming appended output

**Options:**

- `-w, --watch` — continuous mode, refresh every N seconds (default: 5)
- `-i, --interval <seconds>` — refresh interval for watch mode

### 3.4 `ralph kill`

Force-stop ralph and all child processes (agent sessions, watchers, etc.).

**Behavior:**

- Find all ralph-related processes
- Kill them (process tree)
- Report what was killed or "Ralph is not running"

### 3.5 `ralph milestones`

Generate `docs/MILESTONES.md` — a quick-scan index of tasks grouped by milestone.

**Output format:**

```markdown
# Milestones

## N — Milestone Name ($total_cost)

- [x] T-NNN: Title — $cost
- [ ] T-NNN: Title
```

Includes per-milestone cost rollup and grand total.

### 3.6 `ralph shas`

Backfill or correct commit SHAs in task files.

**Behavior:**

- Scan all DONE tasks
- Find the matching `T-NNN:` commit in git log
- Update the `Commit` field if missing or incorrect
- Report changes

### 3.7 `ralph cost`

Calculate and display token usage and estimated cost from ralph log files.

**Modes:**

- `ralph cost <logfile>` — single log file
- `ralph cost --task T-NNN` — all logs for a specific task
- `ralph cost --all` — all logs, grouped by task
- `ralph cost --total` — grand total only
- `ralph cost --update-tasks` — write cost into each DONE task file

**Output:** tabular display with columns: Input tokens, Cache Write, Cache Read, Output tokens, Cost.

## 4. Log Files

Ralph stores iteration logs in `.ralph-logs/` as JSONL files.

- Naming: `T-NNN-YYYYMMDD-HHMMSS.jsonl`
- Content: Agent's JSON stream output (tool calls, text, usage, errors)
- Used by `ralph cost` and `ralph monitor` for analysis

## 5. The Boot Prompt

The boot prompt is a Markdown template stored in the user's project at `docs/prompts/boot.md`. It is the methodology's instruction set — each stateless agent session follows its rules.

### 5.1 Template Variables

The template supports variable interpolation using `{{variable}}` syntax. Ralph replaces these before sending the prompt to the agent:

| Variable                      | Value                                                              |
| ----------------------------- | ------------------------------------------------------------------ |
| `{{task.id}}`                 | e.g., `T-005`                                                      |
| `{{task.title}}`              | Task title                                                         |
| `{{task.description}}`        | Task description                                                   |
| `{{task.prdReference}}`       | e.g., `§3.2`                                                       |
| `{{config.language}}`         | e.g., `TypeScript`                                                 |
| `{{config.packageManager}}`   | e.g., `pnpm`                                                       |
| `{{config.testingFramework}}` | e.g., `Vitest`                                                     |
| `{{config.qualityCheck}}`     | e.g., `pnpm check`                                                 |
| `{{config.testCommand}}`      | e.g., `pnpm test`                                                  |
| `{{config.fileNaming}}`       | e.g., `kebab-case` (blank if unset)                                |
| `{{config.database}}`         | e.g., `PostgreSQL` (blank if unset)                                |
| `{{task.touches}}`            | Comma-separated file paths from the Touches field (blank if unset) |
| `{{task.hints}}`              | Content of the task's Hints section (blank if no Hints section)    |
| `{{task.prdContent}}`         | Extracted PRD section content matching the task's PRD Reference    |
| `{{project.rules}}`           | Contents of `docs/prompts/rules.md` (see §5.9)                     |
| `{{codebaseIndex}}`           | Auto-generated file/export index (see §5.5)                        |
| `{{retryContext}}`            | Context from a previous failed attempt, if any (see §5.6)          |

### 5.2 Default Template

`ralph init` drops a default `docs/prompts/boot.md` that instructs the agent to:

1. Read the task file and referenced PRD sections
2. Implement using red/green TDD
3. Run the quality check command after each layer
4. Commit with message format `T-NNN: description`
5. Update the task file in the same commit
6. Use adequate timeouts for test/build commands
7. Complete ONE task, then stop

### 5.3 Customization

Users may edit `docs/prompts/boot.md` freely before running `ralph loop`. This allows teams to adjust methodology rules, add project-specific instructions, or change the TDD workflow without modifying ralph's source code.

### 5.4 Inline PRD Section Injection

The boot prompt must include the actual content of the PRD section referenced by the task, not just a section number. At prompt build time, ralph parses the `PRD Reference` field (e.g., `§3.2`), extracts the corresponding section from `docs/PRD.md`, and injects it as a `{{task.prdContent}}` template variable. This eliminates the agent wasting turns reading the entire PRD to find the relevant section.

### 5.5 Codebase Index

Before each iteration, ralph generates a lightweight codebase index — a list of source files with their exported symbols — and injects it into the prompt as `{{codebaseIndex}}`. This lets the agent surgically read only the files it needs instead of exploring the entire codebase during the Boot phase.

The index is generated by scanning source files (e.g., `src/**/*.ts`) and extracting export signatures. It should be compact (file path + exported names, one line per file) and regenerated at the start of each iteration.

**Scaling note:** A full codebase index becomes expensive at ~500–1,000+ source files (~15k–30k+ tokens), where it starts competing for context space and undermining prompt cache hits. Future versions may need to filter the index (e.g., by proximity to the task's `Touches` paths or a token budget cap), but this is not a concern for now — ralph projects are typically greenfield and will stay well under that threshold.

### 5.6 Retry Context

When a task is being retried after a failed iteration, ralph injects context from the previous attempt into the boot prompt as `{{retryContext}}`. This variable is empty on the first attempt and populated on retries. See §3.2 for what is extracted from the failed log.

The retry context should instruct the agent to:

- Not repeat the same approach that failed
- Focus on the failure point (e.g., if Verify failed, focus on fixing quality issues rather than rewriting from scratch)
- Reference the specific files that were modified in the previous attempt

### 5.7 Layered Prompt Architecture

As the codebase and prompt grow, the boot prompt should be split into layers to maximize API cache hits and reduce token waste:

| Layer        | Content                                                         | Stability                                 |
| ------------ | --------------------------------------------------------------- | ----------------------------------------- |
| **System**   | TDD methodology, tool usage rules, commit format, quality gates | Stable across all iterations (cacheable)  |
| **Project**  | Config values, file naming, quality commands                    | Stable across iterations (cacheable)      |
| **Rules**    | Project-specific rules from `docs/prompts/rules.md`             | Stable across iterations (cacheable)      |
| **Codebase** | Auto-generated file/export index                                | Changes only when files are added/removed |
| **Task**     | Task description, PRD section content, touches, hints           | Changes per task                          |
| **Retry**    | Previous failure context                                        | Only present on retries                   |

For agents that support `--system-prompt` (or equivalent), the System and Project layers should be passed as the system prompt, and the remaining layers as the user prompt. This maximizes prompt caching at the API level.

### 5.8 Boot Phase Guidance

The default boot prompt template must include explicit guidance to prevent the agent from wasting tokens during the Boot phase:

- **Task re-discovery prevention**: The prompt must clearly state that the loop has already selected the task — the agent should not scan task files to find the next eligible task.
- **File scoping**: When the task has a `Touches` field, the prompt lists those files as the starting point — read these first, skip unrelated files.
- **Read budget**: The prompt should encourage the agent to begin writing tests within a bounded number of tool calls (e.g., 10), preventing the defensive "read everything" pattern.
- **Targeted verification**: During TDD cycles, the agent should run only the relevant tests (specific test file or `--grep` pattern) and lint/typecheck only changed files — not the full quality check command. The full quality check runs **once** at the end, before committing. This prevents idle time scaling linearly with project size while maintaining the same quality gates.
- **Commit phase batching**: The prompt must instruct the agent to minimize tool calls during the wrap-up phase. Specifically:
  - Update all task metadata fields (Status → DONE, Completed timestamp, Completion Notes) in a **single edit call**, not separate edits per field.
  - Stage and commit immediately after — do not re-read the task file to verify the edit.
  - Do not backfill the commit SHA — the loop handles that post-iteration.
  - The entire commit phase should complete in 2 tool calls (one edit, one commit), not 3–4.
- **Command output hygiene**: The prompt must instruct the agent to minimize noisy command output that wastes context tokens. Specifically:
  - Use quiet/silent flags when available (e.g., `--silent`, `--quiet`, `-q`) for package manager commands, linters, and build tools where only the exit code or error output matters.
  - Redirect stderr to `/dev/null` for known-noisy commands when warnings are irrelevant to the task.
  - When a command produces verbose output, prefer checking the exit code over reading the full output.
- **Anti-patterns**: The prompt includes known pitfalls observed from log analysis:
  - After running formatters, re-read modified files — formatting may change code.
  - Write semantic test assertions, not string-matching against prompt text.
  - Do not amend commits to add the SHA — leave it for the loop's post-iteration handling.

### 5.9 Project-Specific Rules

Project-specific rules and constraints live in `docs/prompts/rules.md`, a user-editable Markdown file. This file is the place for instructions like "all code goes under `src/foo/`", "do not use library X", or "tests go in `__tests__/`" — rules that apply to every task but are specific to the project, not to the methodology or the agent.

At prompt build time, ralph reads `docs/prompts/rules.md` and injects its contents as the `{{project.rules}}` template variable. If the file does not exist or is empty, the variable resolves to an empty string.

`ralph init` generates a default `docs/prompts/rules.md` with a brief comment explaining its purpose and a few example rules. Users edit this file to add their project's conventions.

This keeps agent instructions files (`.claude/CLAUDE.md`, `GEMINI.md`, etc.) thin — they contain only a project goal and a pointer to the methodology. All behavioral rules flow through the prompt template, which is agent-agnostic.

## 6. Quality Gates

Ralph enforces these quality gates via the boot prompt:

- All tests pass
- Quality check command passes (lint, format, typecheck, build, test)
- Every line of production code exercised by a test
- No code smells (dead code, TODOs, duplication)
- No security vulnerabilities
- One commit per task, task file update in the same commit

## 7. Git Safety

- Auto-push enabled by default (`--no-push` to disable)
- Never discard staged changes — only unstaged changes from crashed iterations
- Clean shutdown on Ctrl+C

## 8. Robustness & Configuration

### 8.1 Structured Parsing

Task file and config parsing must not rely on brittle regex patterns that break on minor formatting variations. Use a proper Markdown parser (e.g., `unified`/`remark`) or extract structured data from frontmatter to make parsing resilient to whitespace, bold syntax variations, and other Markdown-level changes.

Shared concerns (e.g., AST traversal, field extraction) must be implemented once in a single utility module. Consumers call into the shared utility rather than reimplementing the same logic.

### 8.2 Externalized Configuration

Operational parameters that change independently of code must be configurable without rebuilding:

- **API Pricing** — token prices used by `ralph cost` (currently hardcoded in `commands/cost.ts`)
- **Complexity Tiers** — scaling thresholds and limits used by `ralph loop` (currently hardcoded in `commands/loop.ts`)

These should be overridable via a config file (e.g., `ralph.config.json` or a section in `.claude/CLAUDE.md`) or environment variables, with sensible defaults baked in.

### 8.3 Process Tree Termination

`killProcessTree` must actually traverse and terminate the full process tree. The current implementation sends signals to a single PID without walking child processes. Use process group IDs (`-pid`) or a library like `tree-kill` to ensure spawned compilers, test runners, and other children are cleaned up.

Process discovery must not scan the global process table (e.g., `ps ax -o pid,command`), as this can inadvertently capture sensitive information (API keys, passwords) from unrelated processes' command-line arguments. Use PID-scoped approaches (process groups, parent-child traversal) instead.

### 8.4 Error Visibility

Silent error suppression in the loop and git operations must be eliminated. All errors should be logged to stderr or to `.ralph-logs/` so users can diagnose failures. A loop iteration that fails silently and continues is worse than one that fails loudly.

### 8.5 Git Remote & Branch Configuration

The tool must not hardcode `origin` and `main` as the git remote and branch. These should be auto-detected from the current repository or configurable in project settings.

### 8.6 Command Architecture

Commands must be thin entry points that parse arguments and delegate to focused, single-responsibility services. Business logic — orchestration, git operations, prompt generation, etc. — belongs in independently testable service modules, not in the command handler itself.

### 8.7 Async-First I/O

All file system and I/O operations must use async APIs (`node:fs/promises`, `await`) consistently throughout the codebase. Synchronous variants (`mkdirSync`, `writeFileSync`, etc.) must not be used.

### 8.8 Build vs. Borrow

Minimize dependencies to keep the CLI lightweight, but do not hand-roll logic for problem domains that are error-prone, security-sensitive, or already solved by well-vetted libraries (e.g., process tree management, structured file format parsing/transformation). Prefer a trusted dependency over a fragile manual implementation.

### 8.9 Shell Argument Safety

All strings passed as arguments to shell commands (task IDs, titles, file paths, config values) must be treated as untrusted. Use array-form `execFile`/`spawn` (never shell-interpolated strings), and sanitize or validate inputs before passing them to external processes as a defense-in-depth measure.

## 9. Non-Goals

- Ralph does NOT manage or install AI coding agents — it assumes the configured CLI is available
- Ralph does NOT handle CI/CD — it's a local development tool
- Ralph does NOT require a database — DB setup is project-specific
- Ralph does NOT prescribe a specific language or framework — it works with any stack

## 10. Agent Providers

Ralph supports multiple AI coding agents through a provider adapter. Each provider maps ralph's needs onto the agent's CLI interface.

### 10.1 Provider Interface

Every provider must supply:

| Capability                     | Description                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| **binary**                     | CLI executable name                                                                                     |
| **buildArgs(prompt, options)** | Construct the argument array for a headless, single-prompt invocation (including `--model` if provided) |
| **outputFormat**               | How to request structured (JSON/NDJSON) output, if supported                                            |
| **supportsMaxTurns**           | Whether the agent accepts a max-turns limit                                                             |
| **instructionsFile**           | Path to the agent's project-level instructions file                                                     |
| **parseOutput(stream)**        | Normalize the agent's output stream into ralph's internal event format                                  |

### 10.2 Supported Agents

| Agent                     | Binary   | Print mode        | JSON output                   | Max turns       | Instructions file         |
| ------------------------- | -------- | ----------------- | ----------------------------- | --------------- | ------------------------- |
| **Claude Code** (default) | `claude` | `-p`              | `--output-format stream-json` | `--max-turns N` | `.claude/CLAUDE.md`       |
| **Gemini CLI**            | `gemini` | `-p`              | `--output-format stream-json` | N/A             | `GEMINI.md`               |
| **Codex CLI**             | `codex`  | `exec` subcommand | `--json`                      | N/A             | `AGENTS.md`               |
| **Continue CLI**          | `cn`     | `-p`              | `--output-format stream-json` | `--max-turns N` | `~/.continue/config.yaml` |
| **Cursor CLI**            | `cursor` | `-p`              | `--output-format stream-json` | N/A             | `.cursor/rules/`          |

### 10.3 Behavior When Max Turns Is Unsupported

For agents that do not support `--max-turns`, ralph relies on its own timeout mechanism (§3.2) to bound iteration length. The complexity scaling tiers still apply to timeout values.

### 10.4 Adding New Providers

New agents can be supported by implementing the provider interface (§10.1) and registering the provider. No changes to the orchestrator or prompt system should be required.
