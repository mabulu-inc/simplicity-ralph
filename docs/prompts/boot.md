You are in Ralph Loop iteration. Follow the Ralph Methodology.

PHASE LOGGING (MANDATORY): Before starting each phase, output a marker line EXACTLY like this:
[PHASE] Entering: <phase name>
The phases in order are:

1. Boot — reading task files, PRD, and existing code to understand the task
2. Red — writing failing tests
3. Green — implementing the minimum code to pass tests
4. Verify — running {{config.qualityCheck}} (lint, format, typecheck, build, test:coverage)
5. Commit — staging files and committing

CURRENT TASK (already selected — do NOT scan task files or check statuses):
{{task.id}}: {{task.title}}
PRD Reference: {{task.prdReference}}
Description: {{task.description}}

PROJECT CONFIG:

- Language: {{config.language}}
- Package manager: {{config.packageManager}}
- Testing framework: {{config.testingFramework}}
- quality check: {{config.qualityCheck}}
- Test command: {{config.testCommand}}
- File naming: {{config.fileNaming}}
- Database: {{config.database}}

{{project.rules}}

WORKFLOW:

1. BOOT: Read the task file (docs/tasks/{{task.id}}.md) and PRD sections it references. Begin writing tests within 10 tool calls — do not exhaustively explore the codebase.
2. EXECUTE: Implement using strict red/green TDD — write failing tests FIRST, then implement the minimum to pass. Run '{{config.qualityCheck}}' after each layer — do NOT wait until the end.
3. Quality gates (mandatory before commit):
   - Every line of production code must be exercised by a test. No untested code.
   - No code smells: no dead code, no commented-out blocks, no TODO/FIXME/HACK, no duplication.
   - No security vulnerabilities.
   - Run '{{config.qualityCheck}}' — must pass clean.
4. COMMIT: ONE commit per task. Message format 'T-NNN: description' (e.g. '{{task.id}}: ...').
   The task file update (Status→DONE, Completed timestamp, Commit SHA, Completion Notes) MUST be in the same commit as the code — never a separate commit.
5. TOOL USAGE (STRICT):
   - Read files: ALWAYS use the Read tool. NEVER use cat, head, tail, or sed to read files.
   - Search code: ALWAYS use Grep or Glob tools. NEVER use grep, find, or ls in Bash.
   - The ONLY acceptable Bash uses are: git, {{config.packageManager}}, docker, and commands with no dedicated tool.
6. BASH TIMEOUTS: When running test/build commands via Bash, set timeout to at least 120000ms (120 seconds). TypeScript compilation and test suites need time. Never use 30000ms or less for test/build commands.
7. Do NOT push to origin — the loop handles that.
8. Complete ONE task, then STOP. Do not start a second task.

ANTI-PATTERNS (avoid these):

- After running formatters, re-read modified files — formatting may change code.
- Write semantic test assertions, not string-matching against prompt text.
- Do not amend commits to add the SHA — leave it for the loop's post-iteration handling.
- Do not re-read the task file after updating it. Stage and commit immediately.
- Use quiet flags (--silent, -q) for package manager commands where only the exit code matters.
