# Milestones

## 1 — Infrastructure ($0.82)

- [x] T-000: Project infrastructure and CLI skeleton — $0.82

## 2 — Core Modules ($1.95)

- [x] T-001: Task file parser — $0.51
- [x] T-002: Project config parser — $0.51
- [x] T-003: Git operations module — $0.46
- [x] T-004: Process management module — $0.47

## 3 — Utility Commands ($3.22)

- [x] T-005: Kill command — $0.38
- [x] T-006: SHAs command — $0.72
- [x] T-007: Milestones command — $0.53
- [x] T-008: Cost command — $0.73
- [x] T-009: Monitor command — $0.86

## 4 — The Loop ($1.34)

- [x] T-010: Loop command — $1.34

## 5 — Init Command ($0.95)

- [x] T-011: Init templates — $0.41
- [x] T-012: Init command — $0.54

## 6 — Integration & Polish ($2.19)

- [x] T-013: End-to-end integration tests — $0.73
- [x] T-016: Task complexity scoring — $0.74
- [x] T-017: Loop complexity scaling and boot prompt update — $0.72

## 7 — CI/CD & Publishing ($0.63)

- [x] T-014: CI workflow — $0.42
- [x] T-015: Publish workflow — $0.21

## 8 — Robustness ($10.25)

- [x] T-018: Structured Markdown parsing for task and config files — $0.82
- [x] T-019: Externalize pricing and complexity tier configuration — $0.71
- [x] T-020: Fix process tree termination — $0.39
- [x] T-021: Improve error visibility in loop and git operations — $0.76
- [x] T-022: Configurable git remote and branch — $0.84
- [x] T-023: Decompose loop.ts into focused services — $1.28
- [x] T-024: Consolidate Markdown AST utilities into core/markdown.ts — $0.48
- [x] T-025: Replace regex-based Markdown mutations with AST transformer — $0.65
- [x] T-026: Migrate init.ts from sync to async file system APIs — $0.28
- [x] T-027: Refactor monitor watch mode to a live dashboard — $1.03
- [x] T-028: Replace global process table scanning with PID-scoped process management — $1.19
- [x] T-029: Add input sanitization for shell command arguments — $0.67
- [x] T-056: Show defaults and options in init prompts — $0.53
- [x] T-057: Improve loop logging when agent session hits max turns — $0.62
- [ ] T-058: Parse explicit Complexity field from task files
- [ ] T-059: ralph update command to refresh methodology and prompts

## 9 — Agent Abstraction ($6.23)

- [x] T-030: Externalize boot prompt as a user-editable template — $1.98
- [x] T-031: Agent provider abstraction and adapter interface — $1.08
- [x] T-032: Implement Gemini CLI agent provider — $0.80
- [x] T-033: Implement Codex CLI agent provider — $0.52
- [x] T-034: Implement Continue CLI and Cursor CLI agent providers — $0.73
- [x] T-035: Update ralph init to scaffold ralph.config.json and prompt agent selection — $1.12

## 10 — Prompt Quality & Scalability ($10.29)

- [x] T-036: Add boot phase guidance and anti-patterns to default prompt template — $0.80
- [x] T-037: Add Touches and Hints fields to task parser — $0.57
- [x] T-038: Inline PRD section injection in boot prompt — $0.45
- [x] T-039: Auto-generate codebase index for boot prompt — $0.84
- [x] T-040: Retry context injection from failed iterations — $1.54
- [x] T-041: Layered prompt architecture with system prompt separation — $2.22
- [x] T-042: Externalize all prompt content into user-editable templates — $1.01
- [x] T-043: Add project rules template and slim down agent instructions files — $1.61
- [x] T-044: Add file naming prompt to ralph init — $0.32
- [x] T-045: Make ralph init idempotent with smart defaults and diff-based overwrite — $0.93

## 11 — Post-Iteration & Housekeeping ($5.01)

- [x] T-046: Wire post-iteration metadata updates into orchestrator — $0.65
- [x] T-047: Add current phase timing and last log line to monitor — $0.73
- [x] T-048: Add --json flag to ralph monitor for machine-readable output — $0.61
- [x] T-049: Improve monitor phase timeline with per-phase durations and live timer — $0.99
- [x] T-052: Fix monitor last output disappearing during tool-heavy stretches — $0.72
- [x] T-054: Freeze monitor timers when status is STOPPED — $0.46
- [x] T-055: Preserve planning artifacts during clean slate — $0.85

## 3 — Hardening ($0.77)

- [x] T-050: Remove --no-db flag dead code — $0.31
- [x] T-051: Inject timestamps into JSONL log lines — $0.46

## 12 — Documentation ($1.46)

- [x] T-053: Add README and GitHub Pages documentation site — $1.46

**Grand Total: $45.11**
