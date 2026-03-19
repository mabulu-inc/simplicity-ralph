# @smplcty/ralph — Product Requirements Document

A CLI tool that implements the Ralph Methodology: stateless, PRD-driven AI development automated by AI coding agents.

Any project can `npx @smplcty/ralph init` to bootstrap, then `ralph loop` to build.

## 1. Task File Format

> **Public API** — The task file format is a stable contract. See §12.2 for the full field reference and backward-compatibility guarantees.

Ralph's unit of work is a **task file** (`docs/tasks/T-NNN.md`). Each file has:

```markdown
# T-NNN: Short title

- **Status**: TODO | DONE
- **Milestone**: N — Name
- **Depends**: T-XXX, T-YYY (or "none")
- **PRD Reference**: §N.N
- **Complexity**: light | standard | heavy (optional — overrides auto-detection; see §1.3)
- **Touches**: `path/to/file.ts`, `path/to/other.ts` (optional — files the task will read or modify)
- **Model**: (optional — overrides project default, e.g., `claude-opus-4-20250514`)
- **Roles**: DBA, Compliance Officer (optional — restricts active roles; see §9.6)
- **Completed**: YYYY-MM-DD HH:MM (Nm duration)
- **Commit**: <SHA>
- **Cost**: $N.NN

## Description

What to implement and why.

## AC

Acceptance criteria.

## Hints

(Optional) Implementation guidance for the agent — sent as a separate prompt variable.

## Produces

- `path/to/file.ts`
- Tests
```

All sections except Hints, Produces, Completion Notes, and Blocked are included in the task body sent to the agent. Users may add any custom sections (e.g., `## Security Considerations`, `## Migration Plan`) and they will reach the agent automatically. Run `ralph show task T-NNN` to verify. Use `ralph task` (§3.10) to scaffold a new task file.

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

### 1.3 Complexity Tiers

The `Complexity` field controls how many agent turns and wall-clock time the loop allocates to a task:

| Tier       | Turns | Timeout | Use when…                                                             |
| ---------- | ----- | ------- | --------------------------------------------------------------------- |
| `light`    | 50    | 600s    | Single-file change, isolated unit, no cross-cutting concerns          |
| `standard` | 75    | 900s    | Touches 2-3 files/packages, moderate test surface                     |
| `heavy`    | 125   | 1200s   | Cross-package refactor, infrastructure overhaul, large test migration |

If `Complexity` is omitted, the loop falls back to a keyword/dependency heuristic. Explicit values are preferred — the heuristic frequently underestimates cross-cutting tasks.

## 2. Project Configuration

Ralph reads project configuration from a `ralph.config.json` file at the project root. This is the single source of truth for all structured config — agent instructions files contain only a project goal and methodology pointer, not config values.

### 2.1 Required Config Fields

- **Language** — e.g., TypeScript, Python, Go
- **Package manager** — e.g., pnpm, npm, yarn, pip, cargo
- **Testing framework** — e.g., Vitest, Jest, pytest
- **Quality check** — the command that must pass before committing (e.g., `pnpm check`)
- **Test command** — the command to run tests (e.g., `pnpm test`)
- **Agent** — which AI coding agent to use (default: `claude`). See §11 for supported agents.
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
- `docs/tasks/T-000.md` — infrastructure bootstrap task
- `docs/prompts/rules.md` — user-editable project-specific rules included in the boot prompt (see §5.10)
- `ralph.config.json` — project configuration including agent selection

Ralph does NOT generate or manage agent instructions files (`.claude/CLAUDE.md`, `GEMINI.md`, etc.). The loop prompt is fully self-contained — everything the agent needs is sent via the `-p` flag at runtime. Users' own agent instructions files are their property and ralph never touches them. See §11.5.

All methodology content, prompt templates, and role definitions live in ralph's package code and are used directly at runtime — they are never copied into the user's project. See §5 for the built-in-first prompt architecture.

**Behavior:**

- If files already exist, warn and ask before overwriting
- If applicable (Node.js projects), add ralph scripts to `package.json`
- If no check command exists, scaffold one (e.g., add a `check` script to `package.json`)
- Auto-detect installed agent CLIs and default the agent prompt to the first one found (preference order: claude, gemini, codex, continue, cursor). Fall back to claude if none are detected.
- If the selected agent CLI is not installed, warn the user and continue (they may install it later before running `ralph loop`)

### 3.2 `ralph loop`

The main AI development loop. Runs the configured AI coding agent in stateless iterations, each picking up the next eligible task.

**Iteration cycle:**

1. **Pre-flight** — verify the configured agent CLI is installed and on PATH, `docs/tasks/` exists
2. **Database** — if project has Docker Compose, start containers before each iteration
3. **Clean slate** — discard unstaged changes from crashed iterations, except in protected planning paths (`docs/tasks/`, `docs/PRD.md`, `docs/prompts/`, `ralph.config.json`). These human-authored planning artifacts must survive the clean slate so users can queue task files, PRD edits, and prompt changes between iterations without committing first.
4. **Find next task** — scan task files, select lowest-numbered eligible TODO
5. **Build prompt** — assemble the prompt from built-in templates and user extensions (see §5), interpolate task and config variables
6. **Launch agent** — spawn the configured agent CLI with the rendered prompt and resolved model (task-level model overrides project default; see §11)
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
- `--allow-dirty` — proceed even if the quality-check preflight finds pre-existing failures (default: abort)
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

This context is injected into the boot prompt so the agent can avoid repeating the same mistake. See §5.7.

**Exit conditions:**

- All tasks are DONE
- Reached max iterations
- Loop budget exceeded
- No eligible tasks (all remaining are blocked or have unmet dependencies)
- User interrupt (Ctrl+C)

Every exit must produce a clear, reason-specific console message that includes the exit reason and remaining task counts (e.g., `"Loop complete — iteration limit (10) reached, 13 TODO tasks remaining"`). The ambiguous message `"Loop complete"` without context is not acceptable — developers running ralph unattended must be able to determine why it stopped from the terminal output alone.

**Structured exit log:**

On exit, ralph must write `.ralph-logs/loop-end.json` containing:

- `reason` — one of `all_done`, `iteration_limit`, `budget_exceeded`, `no_eligible_tasks`, `user_interrupt`
- `endedAt` — ISO 8601 timestamp
- `iterationsUsed` — number of iterations completed
- `iterationsLimit` — configured iteration limit (0 = unlimited)
- `totalSpend` — total cost across all iterations
- `tasksCompleted` — number of tasks completed this run
- `tasksRemaining` — number of TODO tasks at exit
- `lastTaskId` — ID of the last task attempted

This file is consumed by `ralph monitor` to display the exit reason when the loop is stopped.

**Iteration state file:**

At the start of each iteration, ralph must write `.ralph-logs/loop-state.json` containing the current iteration number, iteration limit, and current task ID. This enables `ralph monitor` to display iteration progress (e.g., `Iteration: 5/10`) in real time.

**Dynamic task detection:**

At the top of each iteration, after scanning tasks, ralph must compare the current task total against the `loop-start.json` snapshot total. If new tasks have been added to `docs/tasks/` while the loop is running, ralph must:

1. Log a notice: `"[Iteration N] detected M new tasks (total: T)"`
2. Update the `loop-start.json` total so monitor progress bars remain accurate

This detection must piggyback on the existing task scan — no filesystem watchers, inotify, or additional polling. The loop already calls `scanTasks()` each iteration; comparing counts is sufficient.

**Cleanup on exit:**

- Stop database containers (if started)
- Kill any child processes

### 3.3 `ralph monitor`

Real-time status display showing progress and current activity.

**Displays:**

- Ralph status (RUNNING / BETWEEN TASKS / STOPPED)
- Progress bar with task counts (done/total, percentage)
- Iteration progress — current iteration and limit read from `.ralph-logs/loop-state.json` (e.g., `Iteration: 5/10` or `Iteration: 5/∞` when unlimited). Only shown when the file exists (i.e., when a loop is or was running).
- Exit reason — when status is STOPPED and `.ralph-logs/loop-end.json` exists, display why the loop stopped (e.g., `Stopped: iteration limit reached (10/10), 13 tasks remaining`). This is critical for developers returning to their terminal after an unattended run.
- Current task ID and title
- Phase timeline with per-phase durations — completed phases show elapsed time and the active phase shows a live timer that updates each refresh, both using the same format (e.g., `● Boot (45s) → ● Red (1m 12s) → ● Green (2m 30s) → ○ Verify → ○ Commit`)
- Phases should always display when RUNNING (even if no phase markers found yet — show all as `○`)
- Last output with staleness — the most recent text content from the agent, truncated to terminal width, with a staleness indicator showing how long ago it was emitted (e.g., `Last output (2m 13s ago): Let me verify the tests fail.`). The last output line must never disappear — if no text is found in the recent log tail, retain the last known text and update the staleness timer so the user can gauge whether the agent is stuck.
- Activity indicator — when the most recent log entries are tool calls (no text), show what the agent is currently doing as a fallback (e.g., `Activity: Bash (14s ago)` or `Activity: Edit src/ralph/core/process.ts`). This fills the visual gap during tool-heavy stretches where no text output exists.

**Behavior:**

- Watch mode renders as a live dashboard — clear the screen before each refresh so the display updates in place rather than streaming appended output
- Default refresh interval is 1 second for a responsive live timer
- Log tail reading for last-output parsing should use a larger window (32KB) or a two-pass approach to avoid missing the last text entry during long tool-call sequences where 8KB of tool results can push text content out of the tail window

**Options:**

- `-w, --watch` — continuous mode, refresh every N seconds (default: 1)
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

### 3.8 `ralph retry`

Reset one or more BLOCKED tasks so they can be retried from scratch. Logs are preserved but moved out of the retry-count path.

**Usage:**

```
ralph retry T-005 [T-006 ...]
```

**Behavior:**

- Only BLOCKED tasks are eligible — error on TODO or DONE tasks
- Set `Status` back to `TODO`, remove `Blocked reason` field
- Move all `.ralph-logs/T-NNN-*.jsonl` files into `.ralph-logs/T-NNN-resets/` (the archive folder accumulates across multiple resets)
- If the task is already TODO with no logs, no-op with a message
- Supports multiple task IDs in a single invocation

### 3.9 `ralph show`

Transparency command that displays the effective content ralph uses at runtime — built-in defaults merged with any user extensions. This lets users inspect exactly what the agent sees without reading ralph's source code.

**Subcommands:**

- `ralph show system-prompt` — the effective system prompt (built-in + user extensions from `docs/prompts/system.md`)
- `ralph show boot-prompt` — the effective boot prompt template (built-in + user extensions from `docs/prompts/boot.md`), with template variables shown as placeholders
- `ralph show roles` — all active roles (built-in + custom), showing which are overridden, added, or disabled by the user
- `ralph show methodology` — the full Ralph Methodology reference (built-in + user extensions from `docs/prompts/methodology.md`)
- `ralph show rules` — project-specific rules from `docs/prompts/rules.md`
- `ralph show task T-NNN` — the effective task body that the agent will receive for a specific task, showing exactly which sections are included and which are excluded. Also shows the resolved role list (built-in defaults filtered by task-level `Roles` field if present, merged with user customizations from `docs/prompts/roles.md`). This is the primary verification tool for users extending task files with custom sections — run it to confirm your content reaches the agent.

**Options:**

- `--json` — output as JSON (for tooling integration)
- `--built-in-only` — show only ralph's built-in content, ignoring user extensions (useful for diffing against extensions)

**Behavior:**

- Each subcommand displays the merged result of built-in content + user extensions
- If no user extensions exist for a given layer, the built-in content is shown as-is
- If user extensions exist, they are clearly delineated in the output (e.g., a separator showing where built-in ends and user extensions begin)

### 3.10 `ralph task`

Scaffold a new task file with the correct format and next available task number.

```bash
ralph task "Implement user registration"
# → creates docs/tasks/T-081.md

ralph task "Fix login bug" --depends T-040 --complexity light --milestone "3 — Auth"
# → pre-fills fields from flags
```

**Behavior:**

- Scans `docs/tasks/` for the highest `T-NNN` number and increments by one
- Generates a task file from the built-in task template, pre-filled with:
  - The next task number and the provided title
  - `Status: TODO`
  - Fields from CLI flags (`--depends`, `--complexity`, `--milestone`, `--prd-ref`, `--touches`, `--roles`)
  - Placeholder sections (Description, AC) with guidance comments explaining that all custom sections reach the agent
- If `docs/prompts/task-template.md` exists, uses it as the template instead of the built-in default (Extension API — see §12.3)
- Opens the file path in stdout so the user can pipe it to their editor (e.g., `ralph task "Fix bug" | xargs code`)

**Built-in template includes a guidance comment:**

```markdown
<!-- Sections: All sections below are sent to the agent except:
     Hints (sent separately), Produces, Completion Notes, and Blocked.
     Add any custom sections you need — they will reach the agent.
     Run `ralph show task T-NNN` to verify. -->
```

**Options:**

- `--depends <ids>` — comma-separated dependency list (default: `none`)
- `--complexity <tier>` — `light`, `standard`, or `heavy`
- `--milestone <name>` — milestone name (e.g., `"3 — Auth"`)
- `--prd-ref <refs>` — PRD reference (e.g., `"§3.2, §3.3"`)
- `--touches <paths>` — comma-separated file paths
- `--roles <names>` — comma-separated role names for per-task role selection
- `--dry-run` — print the task file to stdout without creating it

### 3.11 `ralph migrate`

One-time migration tool for projects created with ralph versions that copied prompt templates and agent instructions files into the user's project. Under the built-in-first architecture (§5), these copied files are redundant — ralph reads from its compiled code at runtime. But users may have customized them, so they can't be blindly deleted.

```bash
ralph migrate
```

**Scans for legacy files:**

- `docs/prompts/boot.md` — old boot prompt template copy
- `docs/prompts/system.md` — old system prompt template copy
- `docs/prompts/README.md` — old prompt directory documentation
- `docs/RALPH-METHODOLOGY.md` — old methodology copy
- `.claude/CLAUDE.md`, `GEMINI.md`, `AGENTS.md`, `.continue/config.yaml`, `.cursor/rules/ralph.md` — agent instructions files that may contain user customizations beyond ralph's generated stub. Note: the old `ralph update` command silently overwrote these without confirmation.

**For each file found, ralph compares it against known built-in templates** (current and historical versions, with whitespace normalization). Three outcomes:

1. **Exact match (no user changes)** — the file is a verbatim copy of a known built-in template. Ralph deletes it automatically and reports: `Removed docs/prompts/boot.md (matched built-in template, no user changes)`

2. **User modifications detected** — the file differs from all known built-in templates. Ralph extracts the user-specific content (the diff against the closest matching built-in), writes it to the corresponding extension file (e.g., `docs/prompts/boot.md` is rewritten to contain only the user's additions), and reports what it did: `Migrated docs/prompts/system.md → kept user extensions (N lines), removed built-in content`. The user is prompted to review the extracted extensions before confirming.

3. **No matching template found** — the file doesn't resemble any known built-in. Ralph treats the entire file as user content, leaves it in place as an extension, and warns: `docs/prompts/boot.md does not match any known template — treating as user extension. Review with: ralph show boot-prompt`

**Options:**

- `--dry-run` — report what would happen without modifying any files
- `--force` — skip confirmation prompts and apply all changes (for CI/scripting)

**Behavior:**

- Always runs `--dry-run` first and shows the plan before asking for confirmation
- After migration, runs `ralph show system-prompt` and `ralph show boot-prompt` so the user can verify the effective content
- Idempotent — running it again after migration reports "nothing to migrate"
- If the `ralph update` command is invoked, it redirects the user to `ralph migrate` with an explanation

### 3.12 `ralph review`

Post-execution analysis, failure diagnosis, and coaching. This command helps users understand what happened during a task's execution, fix problems with failed tasks, and improve their task definitions, role customizations, and extensions over time.

#### Task review: `ralph review T-NNN`

Displays a structured timeline of what happened when a task was executed:

- **Status summary** — DONE, BLOCKED (with reason), or failed (with exit condition)
- **Attempt history** — if the task was retried, show each attempt with its outcome
- **Phase timeline** — Boot → Red → Green → Verify → Commit with durations per phase
- **Role commentary** — every `[ROLE: ...]` marker from the log, organized by phase. This is the primary way users see the interplay between roles: which roles participated at each gate, what they approved or flagged, and how their feedback shaped the implementation.
- **Key decisions** — significant moments extracted from the log: test strategy (SDET at Red), architectural choices (Architect at Boot), security flags (AppSec at Verify), TDD compliance verdict (SDET at Verify), code review outcome (Tech Lead at Verify)
- **Cost and turns** — token usage, cost, turns used vs. limit
- **Files changed** — list of files modified in the commit (if completed)

If multiple log files exist for the task (retries), all attempts are shown in sequence so the user can see the progression.

#### Failure diagnosis: `ralph review T-NNN --diagnose`

For BLOCKED or failed tasks, analyzes the log to identify the root cause and recommend corrections:

- **Failure classification** — categorizes the failure: timeout, max turns exhausted, quality check failure, blocked by agent, no commit detected, role review rejection
- **Root cause extraction** — parses the log for the last error, the phase where failure occurred, and the context leading up to it
- **Role-specific feedback** — if a role flagged an issue during a gate phase (e.g., Tech Lead rejected code quality, SDET flagged TDD non-compliance), surfaces that commentary as the likely cause
- **Recommendations** — actionable suggestions based on the failure type:
  - Timeout → suggest increasing complexity tier or splitting the task
  - Max turns → suggest adding Hints to reduce exploration, or increasing `--max-turns`
  - Quality check failure → show which check failed and suggest fixes
  - Role rejection → show the role's feedback and suggest task/code adjustments
  - Missing dependency → identify which files or modules the agent tried to use but didn't exist
  - Vague description → flag if the Description section is short or lacks acceptance criteria

#### Project coaching: `ralph review --coach`

Analyzes all completed and failed tasks, role customizations, and extensions to suggest improvements:

**Task quality analysis:**

- Flags TODO tasks with vague or missing Description, no AC section, or missing PRD Reference
- Identifies tasks that consistently exceed their complexity tier (took more turns/time than allocated) — suggests upgrading to a higher tier or splitting
- Identifies tasks that completed well under their tier — suggests downgrading to save budget
- Flags tasks with no Depends that might benefit from explicit dependencies (based on file overlap with other tasks)

**Role effectiveness analysis:**

- Identifies roles that skip on most tasks — suggests disabling them project-wide via `docs/prompts/roles.md` if they're not relevant
- Identifies roles whose commentary is frequently followed by rework — suggests the role's review criteria may need refinement via override
- Flags if custom roles are defined but never referenced in task `Roles` fields

**Extension health:**

- Checks if user extension files exist and reports their status
- If `docs/prompts/rules.md` is empty or default, suggests adding project-specific rules based on patterns observed in completed tasks (e.g., all tasks use the same test directory pattern)
- If task complexity is frequently miscategorized, suggests adding Hints to underperforming tasks

**Options:**

- `--json` — structured JSON output (all modes)
- `--verbose` — include full role commentary text (default: summary only)

## 4. Log Files

Ralph stores iteration logs in `.ralph-logs/` as JSONL files.

- Naming: `T-NNN-YYYYMMDD-HHMMSS.jsonl`
- Content: Agent's JSON stream output (tool calls, text, usage, errors), enriched with timestamps
- Used by `ralph cost` and `ralph monitor` for analysis

### 4.0 Loop Metadata Files

In addition to per-task JSONL logs, ralph writes structured JSON metadata files to `.ralph-logs/`:

- **`loop-start.json`** — Written at loop start. Contains `doneAtStart`, `total`, and `startedAt`. The `total` field is updated in-place when new tasks are detected mid-run.
- **`loop-state.json`** — Written at the start of each iteration. Contains `iteration` (current), `iterationsLimit` (configured cap, 0 = unlimited), `currentTaskId`, and `startedAt`. Consumed by `ralph monitor` for iteration progress display.
- **`loop-end.json`** — Written on loop exit. Contains `reason`, `endedAt`, `iterationsUsed`, `iterationsLimit`, `totalSpend`, `tasksCompleted`, `tasksRemaining`, and `lastTaskId`. Consumed by `ralph monitor` to display exit reason when stopped.
- **`ralph.pid`** — Process ID file for running-state detection.

### 4.1 Timestamp Injection

The agent CLI's raw JSONL output does not include timestamps. Ralph must inject a `timestamp` field (ISO 8601) into each JSONL line as it is written to the log file. This is required for the monitor's per-phase durations and live timer (§3.3) to function.

The log capture layer (`spawnWithCapture`) must not pipe raw output directly to the log file. Instead, it must buffer incoming data into complete lines, parse each line as JSON, inject `"timestamp": "<ISO 8601>"`, re-serialize, and write the enriched line. Non-JSON lines (e.g., stderr) should be written as-is.

## 5. Prompt Architecture — Built-in First with User Extensions

> **Public API** — The extension mechanism is a stable contract. See §12.3 for the full extension file reference and backward-compatibility guarantees.

Ralph's prompts follow a **built-in-first** architecture: all methodology content, prompt templates, and role definitions live in ralph's package code and are used directly at runtime. They are never copied into the user's project. When the user runs `pnpm dlx @smplcty/ralph loop`, they always get the latest prompts.

Users extend ralph's built-in content through optional files in `docs/prompts/`. These files contain **only user additions** — they are appended to (not replacements for) the built-in content. If no extension files exist, ralph works with zero configuration.

**Runtime prompt assembly:**

For each prompt layer, ralph assembles the effective content as:

```
effective_content = built_in_content() + user_extension_content()
```

where `user_extension_content()` reads from the project's `docs/prompts/` directory and returns an empty string if the file does not exist.

**Extension files (all optional, user-authored only):**

| File                          | Extends                   | Purpose                                                                                                 |
| ----------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------- |
| `docs/prompts/system.md`      | Built-in system prompt    | Additional system-level instructions appended after ralph's methodology, roles, and quality gates       |
| `docs/prompts/boot.md`        | Built-in boot prompt      | Additional boot-level content appended after ralph's task/config/scoping sections                       |
| `docs/prompts/rules.md`       | (standalone)              | Project-specific rules injected via `{{project.rules}}` — the one file `ralph init` creates (see §5.10) |
| `docs/prompts/roles.md`       | Built-in role definitions | Role overrides, additions, and disables (see §9.6)                                                      |
| `docs/prompts/methodology.md` | Built-in methodology      | Additional methodology guidance appended after ralph's built-in methodology reference                   |

`ralph init` creates only `docs/prompts/rules.md`. All other extension files are created by the user when they want to customize. `ralph show` (§3.9) lets users inspect the effective merged content.

### 5.1 Template Variables

The built-in boot prompt template supports variable interpolation using `{{variable}}` syntax. Ralph replaces these before sending the prompt to the agent:

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
| `{{project.rules}}`           | Contents of `docs/prompts/rules.md` (see §5.10)                    |
| `{{codebaseIndex}}`           | Auto-generated file/export index (see §5.6)                        |
| `{{retryContext}}`            | Context from a previous failed attempt, if any (see §5.7)          |

Template variables are interpolated in both built-in templates and user extension files, so users can reference task and config values in their extensions.

### 5.2 Built-in System Prompt

The built-in system prompt is compiled into ralph's package and includes:

1. Phase logging requirements (`[PHASE] Entering: ...`)
2. TDD workflow (Boot → Red → Green → Verify → Commit)
3. Quality gates and tool usage rules
4. Agent role definitions and participation rules (§9)
5. Commentary format requirements (`[ROLE: ...]`)
6. Command output hygiene and anti-patterns

This content is stable across all iterations and benefits from prompt caching. Users can inspect it via `ralph show system-prompt`.

### 5.3 Built-in Boot Prompt

The built-in boot prompt is compiled into ralph's package and includes:

1. Current task details (ID, title, description, PRD reference)
2. Project configuration values
3. File scoping guidance
4. Codebase index
5. Retry context (when applicable)
6. Task context for role applicability

Users can inspect it via `ralph show boot-prompt`.

### 5.4 User Extensions

Users extend ralph's built-in content by creating files in `docs/prompts/`. Extension content is appended after the corresponding built-in content, separated by a clear marker in the effective prompt (e.g., `--- Project Extensions ---`).

This means:

- Users never need to duplicate ralph's built-in content
- Ralph upgrades automatically flow to all projects
- User extensions survive upgrades because they are separate files that ralph never overwrites
- `ralph show` displays the merged result so users can verify the effective content

### 5.5 Inline PRD Section Injection

The boot prompt must include the actual content of the PRD section referenced by the task, not just a section number. At prompt build time, ralph parses the `PRD Reference` field (e.g., `§3.2`), extracts the corresponding section from `docs/PRD.md`, and injects it as a `{{task.prdContent}}` template variable. This eliminates the agent wasting turns reading the entire PRD to find the relevant section.

### 5.6 Codebase Index

Before each iteration, ralph generates a lightweight codebase index — a list of source files with their exported symbols — and injects it into the prompt as `{{codebaseIndex}}`. This lets the agent surgically read only the files it needs instead of exploring the entire codebase during the Boot phase.

The index is generated by scanning source files (e.g., `src/**/*.ts`) and extracting export signatures. It should be compact (file path + exported names, one line per file) and regenerated at the start of each iteration.

**Scaling note:** A full codebase index becomes expensive at ~500–1,000+ source files (~15k–30k+ tokens), where it starts competing for context space and undermining prompt cache hits. Future versions may need to filter the index (e.g., by proximity to the task's `Touches` paths or a token budget cap), but this is not a concern for now — ralph projects are typically greenfield and will stay well under that threshold.

### 5.7 Retry Context

When a task is being retried after a failed iteration, ralph injects context from the previous attempt into the boot prompt as `{{retryContext}}`. This variable is empty on the first attempt and populated on retries. See §3.2 for what is extracted from the failed log.

The retry context should instruct the agent to:

- Not repeat the same approach that failed
- Focus on the failure point (e.g., if Verify failed, focus on fixing quality issues rather than rewriting from scratch)
- Reference the specific files that were modified in the previous attempt

### 5.8 Layered Prompt Architecture

The prompt is split into layers to maximize API cache hits and reduce token waste. Each layer has a **built-in** component from ralph's code and an optional **user extension** from the project's `docs/prompts/` directory:

| Layer           | Built-in Content                                        | User Extension File           | Stability                                 |
| --------------- | ------------------------------------------------------- | ----------------------------- | ----------------------------------------- |
| **System**      | TDD methodology, tool usage rules, roles, quality gates | `docs/prompts/system.md`      | Stable across all iterations (cacheable)  |
| **Methodology** | Ralph Methodology reference                             | `docs/prompts/methodology.md` | Stable across all iterations (cacheable)  |
| **Roles**       | 9 built-in role definitions and participation rules     | `docs/prompts/roles.md`       | Stable across all iterations (cacheable)  |
| **Project**     | Config values, file naming, quality commands            | —                             | Stable across iterations (cacheable)      |
| **Rules**       | —                                                       | `docs/prompts/rules.md`       | Stable across iterations (cacheable)      |
| **Codebase**    | Auto-generated file/export index                        | —                             | Changes only when files are added/removed |
| **Task**        | Task description, PRD section content, touches, hints   | —                             | Changes per task                          |
| **Retry**       | Previous failure context                                | —                             | Only present on retries                   |

For agents that support `--system-prompt` (or equivalent), the System, Methodology, Roles, Project, and Rules layers should be passed as the system prompt, and the remaining layers as the user prompt. This maximizes prompt caching at the API level.

User extension files are appended to their corresponding built-in layer. If a user extension file does not exist, the built-in content is used alone. This means ralph works with zero user-authored prompt files — `docs/prompts/rules.md` (created by `ralph init`) is the only prompt file that exists by default.

### 5.9 Boot Phase Guidance

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

### 5.10 Project-Specific Rules

Project-specific rules and constraints live in `docs/prompts/rules.md`, a user-editable Markdown file. This file is the place for instructions like "all code goes under `src/foo/`", "do not use library X", or "tests go in `__tests__/`" — rules that apply to every task but are specific to the project, not to the methodology or the agent.

At prompt build time, ralph reads `docs/prompts/rules.md` and injects its contents as the `{{project.rules}}` template variable. If the file does not exist or is empty, the variable resolves to an empty string.

`ralph init` generates a default `docs/prompts/rules.md` with a brief comment explaining its purpose and a few example rules. Users edit this file to add their project's conventions.

All behavioral rules flow through the prompt template, which is agent-agnostic. Ralph does not generate or manage agent instructions files (see §11.5).

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

These should be overridable via `ralph.config.json` or environment variables, with sensible defaults baked in.

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

## 9. Agent Roles

Each iteration of `ralph loop` is not a single-perspective coding session. It is a structured collaboration between specialized agent roles, each contributing focused expertise at specific phases. The AI agent adopts each role in sequence, producing explicit commentary from that role's perspective. This commentary is part of the agent's output stream and is captured in the iteration's JSONL log file, giving full transparency into the reasoning behind every decision.

Users of ralph should understand that each iteration involves these roles — the log file is the record of their collaboration.

### 9.1 Role Definitions

| Role                                     | Focus                           | Responsibility                                                                                                                                                                                                                                                                                    |
| ---------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Product Manager (PM)**                 | The "Why" and "What"            | Bridges business goals to technical execution. Validates that the task aligns with PRD requirements and acceptance criteria. Ensures the implementation scope matches what was asked for — no more, no less.                                                                                      |
| **System Architect**                     | The "How" at a high level       | Designs the structural blueprint. Reviews the approach for scalability, modularity, and separation of concerns. Prevents spaghetti code that slows future enhancements.                                                                                                                           |
| **Security Engineer (AppSec)**           | Shift-left security             | Reviews designs for vulnerabilities before code is written. Validates that the implementation follows OWASP guidelines and does not introduce injection, XSS, or other common attack vectors. Security is not a final check — it is integrated from the start.                                    |
| **UX/UI Designer**                       | Intuitive design                | Ensures user-facing changes are intuitive and consistent. Reviews CLI output formatting, error messages, and user flows. Prevents costly mid-development pivots by catching usability issues early. Participates only when the task has user-facing surface.                                      |
| **Frontend & Backend Engineers**         | Clean, modular code             | Write the actual implementation. Focus on DRY (Don't Repeat Yourself), SRP (Single Responsibility Principle), and other software engineering principles. Code should be an effective abstraction that enables confident refactoring.                                                              |
| **DevOps / SRE**                         | CI/CD and operational readiness | Evaluates the impact on build pipelines, deployment, and operational concerns. Ensures changes don't break the build, introduce slow tests, or create operational blind spots.                                                                                                                    |
| **SDET (Software Dev Engineer in Test)** | Code that tests code            | Designs the test strategy and builds automated regression suites. Critically, the SDET verifies that TDD actually drove the development — tests must precede implementation, not be added as an afterthought. Evidence of test-first development (failing tests before passing code) is required. |
| **Technical Lead**                       | Code review and mentorship      | Performs rigorous code review as the primary defense for long-term quality and maintainability. Evaluates naming, structure, error handling, and whether the code will be comprehensible to the next developer.                                                                                   |
| **DBA / Data Engineer**                  | Data integrity and performance  | Reviews schema designs, query patterns, and data access layers. Ensures schemas are robust enough to handle growth without requiring a rewrite. Participates only when the task involves data models or persistence.                                                                              |

### 9.2 Role Participation by Phase

Roles participate at specific points in the iteration where their expertise has the highest leverage. Some roles act as **gates** — the iteration must not proceed past that phase without their explicit approval.

| Phase                               | Active Roles                                                                                                                                                                                                                                                                                                                                                                                                          | Gate?                                                                                                                                                       |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Boot** (task analysis & approach) | PM validates task/PRD alignment and acceptance criteria. Architect designs the structural approach. Security Engineer reviews for threat surface. DBA reviews if data models are involved. UX reviews if user-facing changes exist.                                                                                                                                                                                   | **Yes** — the approach must be agreed before any code is written. Each participating role must produce explicit commentary approving or adjusting the plan. |
| **Red** (test writing)              | SDET defines the test strategy and coverage requirements. Engineers write the failing tests.                                                                                                                                                                                                                                                                                                                          | No                                                                                                                                                          |
| **Green** (implementation)          | Engineers write the minimum code to pass tests. Architect provides structural guidance if the implementation drifts from the agreed approach.                                                                                                                                                                                                                                                                         | No                                                                                                                                                          |
| **Verify** (quality gates)          | SDET audits TDD compliance — verifies that tests were written before implementation and are not afterthought assertions bolted onto working code. Security Engineer scans the implementation for vulnerabilities. Tech Lead performs code review for quality, naming, structure, and maintainability. DevOps/SRE evaluates CI/CD and operational impact. DBA reviews query patterns and schema changes if applicable. | **Yes** — all applicable reviews must pass. If a review identifies an issue, it must be resolved before proceeding to Commit.                               |
| **Commit**                          | Engineers produce the clean commit.                                                                                                                                                                                                                                                                                                                                                                                   | No                                                                                                                                                          |

### 9.3 Commentary Format

Each role's commentary must be clearly attributed in the agent's output so it is identifiable in the log. The format uses a role marker:

```
[ROLE: Product Manager] Task T-042 aligns with PRD §5.3. Acceptance criteria require...
[ROLE: System Architect] Proposed approach: extract the parser into a separate module...
[ROLE: Security Engineer] No external input surfaces in this task. No threat model concerns.
```

Roles that are not applicable to a given task (e.g., DBA for a pure UI task, UX for a backend-only task) must explicitly state they are skipping with a reason:

```
[ROLE: UX/UI Designer] Skipping — this task has no user-facing surface.
[ROLE: DBA / Data Engineer] Skipping — no data models or persistence changes.
```

This ensures the log is a complete record — every role is accounted for in every iteration.

### 9.4 TDD Compliance Audit

The SDET role during the Verify phase has a specific mandate: verify that TDD actually drove the development. This is not a check for test existence — it is a check for test-first discipline. The SDET must look for evidence that:

- Tests were written during the Red phase (before implementation)
- Tests initially failed (they tested behavior that didn't exist yet)
- Implementation in the Green phase was the minimum needed to make tests pass
- Tests are semantic assertions about behavior, not string-matching or implementation-coupled checks

If the SDET finds evidence that tests were written after the implementation (e.g., tests that could only have been written by someone who already knew the implementation details, or tests that assert on implementation artifacts rather than behavior), this must be flagged as a review failure.

### 9.5 Log Transparency

All role commentary is part of the agent's standard output stream and is captured in the iteration's `.ralph-logs/T-NNN-*.jsonl` file. No separate log files or channels are needed — the `[ROLE: ...]` markers make each role's contribution identifiable within the existing log format.

`ralph monitor` displays the agent's text output in real time (§3.3). When role commentary is the latest output, the monitor's "Last output" line will naturally show it, giving the developer visibility into which role is currently active.

### 9.6 Role Customization

Users customize roles via `docs/prompts/roles.md`, an optional file that extends the built-in role definitions. The file uses Markdown headings with directives:

**Override a built-in role** — replace its description for this project:

```markdown
## Override: SDET

In this project, the SDET focuses on integration testing with real database connections.
All tests must hit the actual PostgreSQL instance, not mocks.
```

**Add a custom role** — define a new role with its participation phases:

```markdown
## Add: Compliance Officer

- **Focus**: Regulatory compliance
- **Responsibility**: Reviews all data handling for GDPR/HIPAA compliance. Validates that PII is encrypted at rest and in transit. Checks audit logging for sensitive operations.
- **Participates**: Boot, Verify
```

**Disable a built-in role** — exclude it from this project:

```markdown
## Disable: UX/UI Designer

This is a headless API project with no user-facing surface.
```

**Per-task role selection** — task files may include an optional `Roles` field:

```markdown
- **Roles**: DBA, Compliance Officer
```

When `Roles` is present, only the listed roles participate (plus Engineers, which always participate). When absent, all applicable roles participate using the default applicability logic from §9.2.

At prompt build time, ralph merges the built-in role definitions with user customizations from `docs/prompts/roles.md`. Overrides replace the built-in description. Additions are appended. Disables remove the role entirely. The merged result is injected into the system prompt. Users can inspect the effective roles via `ralph show roles`.

## 10. Non-Goals

- Ralph does NOT manage or install AI coding agents — it assumes the configured CLI is available
- Ralph does NOT handle CI/CD — it's a local development tool
- Ralph does NOT require a database — DB setup is project-specific
- Ralph does NOT prescribe a specific language or framework — it works with any stack
- Ralph does NOT generate or manage agent instructions files (`.claude/CLAUDE.md`, `GEMINI.md`, etc.) — these belong to the user (see §11.5)

## 11. Agent Providers

Ralph supports multiple AI coding agents through a provider adapter. Each provider maps ralph's needs onto the agent's CLI interface.

### 11.1 Provider Interface

Every provider must supply:

| Capability                     | Description                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| **binary**                     | CLI executable name                                                                                     |
| **buildArgs(prompt, options)** | Construct the argument array for a headless, single-prompt invocation (including `--model` if provided) |
| **outputFormat**               | How to request structured (JSON/NDJSON) output, if supported                                            |
| **supportsMaxTurns**           | Whether the agent accepts a max-turns limit                                                             |
| **supportsSystemPrompt**       | Whether the agent accepts a separate system prompt argument                                             |
| **parseOutput(stream)**        | Normalize the agent's output stream into ralph's internal event format                                  |

The provider interface does NOT include an `instructionsFile` capability. Ralph's loop prompt is self-contained — it does not depend on or manage agent-specific project instructions files. See §11.5.

### 11.2 Supported Agents

| Agent                     | Binary   | Print mode        | JSON output                   | Max turns       |
| ------------------------- | -------- | ----------------- | ----------------------------- | --------------- |
| **Claude Code** (default) | `claude` | `-p`              | `--output-format stream-json` | `--max-turns N` |
| **Gemini CLI**            | `gemini` | `-p`              | `--output-format stream-json` | N/A             |
| **Codex CLI**             | `codex`  | `exec` subcommand | `--json`                      | N/A             |
| **Continue CLI**          | `cn`     | `-p`              | `--output-format stream-json` | `--max-turns N` |
| **Cursor CLI**            | `cursor` | `-p`              | `--output-format stream-json` | N/A             |

### 11.3 Behavior When Max Turns Is Unsupported

For agents that do not support `--max-turns`, ralph relies on its own timeout mechanism (§3.2) to bound iteration length. The complexity scaling tiers still apply to timeout values.

### 11.4 Adding New Providers

New agents can be supported by implementing the provider interface (§11.1) and registering the provider. No changes to the orchestrator or prompt system should be required.

### 11.5 Agent Instructions File Independence

Ralph does NOT generate, manage, or depend on agent-specific project instructions files (`.claude/CLAUDE.md`, `GEMINI.md`, `AGENTS.md`, `.cursor/rules/`, `.continue/config.yaml`).

**Rationale:**

- The loop prompt (system prompt + boot prompt) is fully self-contained. Everything the agent needs to execute a task — methodology, roles, task description, config, codebase index — is sent via the `-p` flag at runtime. Agent instructions files are redundant with the loop prompt.
- These files belong to the user, not to ralph. Users may have their own agent instructions for manual coding sessions, project-specific AI guidance, or team conventions that have nothing to do with ralph. Ralph must not overwrite, modify, or assume ownership of these files.
- Previous versions of ralph generated agent instructions files during `ralph init` and silently overwrote them during `ralph update`. This caused data loss when users had added their own content. This behavior is removed.

**Migration:** Users with legacy ralph-generated agent instructions files can use `ralph migrate` (§3.11) to detect and preserve any customizations.

### 11.6 AI-Agnostic Workflow

Ralph is designed so that users can use **any AI assistant** — not just the loop's configured agent — to plan tasks, create task files, analyze results, and improve their project. The loop agent executes tasks; everything else is open.

**Planning and task creation:**

- `ralph task "Title" --dry-run` outputs a properly-formatted task scaffold that any AI can review and fill in
- `ralph show task T-NNN` shows what the agent will receive, so any AI can verify task quality before execution
- The Task File API (§12.2) is a documented, stable format — any AI that can read the docs can author task files
- Users can ask their preferred AI (Claude Code, Cursor, Copilot, ChatGPT, etc.) to decompose a PRD into task files using the format documented in the README and docs site

**Reviewing and coaching:**

- `ralph review T-NNN --json` outputs structured execution data that any AI can analyze
- `ralph review --coach --json` outputs structured improvement suggestions
- The JSONL logs in `.ralph-logs/` are readable by any tool — they contain the full agent output including role commentary, phase markers, tool calls, and errors
- Users can feed `ralph review` output to their preferred AI for deeper analysis or alternative perspectives

**Key principle:** Ralph commands that produce analysis (`review`, `show`, `coach`) output to stdout as text or JSON. They do not require a specific AI to consume them. This means the user's workflow can be:

1. Use any AI to plan and write task files
2. Use `ralph loop` to execute (with whichever agent is configured)
3. Use any AI to review results, diagnose failures, and refine tasks

## 12. Public API Contracts

Ralph exposes two public APIs that users build on: the **Task File Format** and the **Extension API**. These are the surfaces where ralph's behavior intersects with user-authored content. Breaking changes to either surface break the user's project. Both must be treated as stable contracts with the same discipline as a library's public API.

### 12.1 Contract Principles

1. **Backward compatibility** — new fields and extension files may be added, but existing fields and extension behaviors must not change meaning or be removed without a major version bump.
2. **Additive only** — between major versions, ralph may add new optional task fields, new extension file types, and new built-in roles. It must not rename, remove, or reinterpret existing ones.
3. **Fail gracefully** — unknown task fields are ignored (not errors). Malformed extension files produce warnings, not crashes. This lets users add custom metadata fields to task files without ralph rejecting them.
4. **Documented and discoverable** — both contracts must be documented prominently in the README, the docs site, and via `ralph show`. A user should never have to read ralph's source code to understand how to write a task file or an extension.

### 12.2 Task File API

The task file format (§1) is a public contract. Users author these files by hand, and external tools may generate them. Ralph guarantees:

**Required fields** (ralph reads these, must be present for the task to be eligible):

| Field           | Format                            | Description                                          |
| --------------- | --------------------------------- | ---------------------------------------------------- |
| `Status`        | `TODO` \| `DONE` \| `BLOCKED`     | Task state. Ralph selects `TODO` tasks.              |
| `Milestone`     | `N — Name`                        | Grouping for progress tracking.                      |
| `Depends`       | Comma-separated `T-NNN` or `none` | Dependency list. All must be `DONE` for eligibility. |
| `PRD Reference` | `§N.N` references                 | Sections injected into the prompt.                   |

**Optional fields** (ralph reads these when present, ignores when absent):

| Field            | Format                           | Description                                        |
| ---------------- | -------------------------------- | -------------------------------------------------- |
| `Complexity`     | `light` \| `standard` \| `heavy` | Overrides auto-detection for turn/timeout scaling. |
| `Touches`        | Comma-separated file paths       | Files injected into the prompt for scoping.        |
| `Hints`          | (section body)                   | Implementation guidance injected into the prompt.  |
| `Model`          | Model identifier string          | Overrides the project default model for this task. |
| `Roles`          | Comma-separated role names       | Restricts which agent roles participate (§9.6).    |
| `Completed`      | `YYYY-MM-DD HH:MM (Nm duration)` | Set by the agent on completion.                    |
| `Commit`         | 40-character SHA                 | Backfilled by ralph post-iteration.                |
| `Cost`           | `$N.NN`                          | Backfilled by ralph post-iteration.                |
| `Blocked reason` | Free text                        | Reason when Status is BLOCKED.                     |

**Sections** — ralph uses an **exclusion-based** model for task sections. Only the sections listed below are excluded from the task body sent to the agent. All other sections — including any custom sections the user adds — are included in `{{task.description}}` and reach the agent automatically.

Excluded sections (not sent to the agent as part of the task body):

| Section               | Reason for exclusion                                         |
| --------------------- | ------------------------------------------------------------ |
| `## Hints`            | Sent separately as `{{task.hints}}` to avoid duplication.    |
| `## Produces`         | Human reference only (expected deliverables).                |
| `## Completion Notes` | Written by the agent after completion, not actionable input. |
| `## Blocked`          | Used for eligibility check, not implementation guidance.     |

Everything else is included. This means users can freely add custom sections like `## Security Considerations`, `## Migration Plan`, `## Performance Requirements`, or any other heading — ralph will include them in the task body sent to the agent.

**Verification:** Users can run `ralph show task T-NNN` (§3.9) to see exactly what the agent will receive, including which sections are included and which are excluded. This eliminates guesswork.

**Any fields or sections not consumed by ralph are preserved as-is.** Users and external tools may add custom metadata fields (e.g., `Assignee`, `Priority`, `Epic`) without affecting ralph's behavior — unknown fields are ignored, custom sections reach the agent.

### 12.3 Extension API

The extension mechanism (§5.4) is a public contract. Users create files in `docs/prompts/` to customize ralph's behavior. Ralph guarantees:

**Extension files and their behavior:**

| File                            | Merge behavior                     | Format                                                                                                                 |
| ------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `docs/prompts/system.md`        | Appended to built-in system prompt | Free-form Markdown. Template variables supported.                                                                      |
| `docs/prompts/boot.md`          | Appended to built-in boot prompt   | Free-form Markdown. Template variables supported.                                                                      |
| `docs/prompts/methodology.md`   | Appended to built-in methodology   | Free-form Markdown.                                                                                                    |
| `docs/prompts/rules.md`         | Injected as `{{project.rules}}`    | Free-form Markdown.                                                                                                    |
| `docs/prompts/roles.md`         | Merged with built-in roles         | Directive headings: `## Override:`, `## Add:`, `## Disable:` (§9.6).                                                   |
| `docs/prompts/task-template.md` | Replaces built-in task scaffold    | Markdown task template used by `ralph task` (§3.10). Must include `{{task.number}}` and `{{task.title}}` placeholders. |

**Guarantees:**

- Extension files are **always optional**. Ralph works with zero extension files.
- Extension files are **never overwritten** by ralph. No command (init, loop, or otherwise) modifies files in `docs/prompts/`.
- Extension content is **appended after** built-in content, separated by a clear marker. User content never replaces built-in content (except role overrides via the explicit `## Override:` directive).
- **Template variables** (`{{task.id}}`, `{{config.language}}`, etc.) are interpolated in extension files, using the same variable set as built-in templates (§5.1).
- `ralph show` always displays the **effective merged result** so users can verify exactly what the agent will see.
- New extension file types may be added in future versions. Existing extension files will continue to work unchanged.

### 12.4 Documentation Requirements

Both contracts must be documented in three places:

1. **README.md** — a concise API reference section showing the task file format and the extension file list with their merge behaviors. This is the first thing a user sees and must be sufficient to get started without clicking through to the docs site.
2. **Docs site** — dedicated reference pages for the Task File API and Extension API, with full field descriptions, examples, and the contract guarantees. These pages should be linked prominently from the Getting Started guide, not buried in a guides section.
3. **`ralph show`** — the CLI itself is documentation. `ralph show roles`, `ralph show system-prompt`, etc. give users live, accurate views of the effective content.

The API reference pages on the docs site should be structured like library API docs: field tables, type definitions, examples, and a "Stability" note at the top stating the backward-compatibility guarantee.
