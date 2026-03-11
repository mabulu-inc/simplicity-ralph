#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# ralph.sh — The Ralph Loop
#
# Runs Claude Code in a stateless loop. Each iteration gets a fresh session
# that scans docs/tasks/T-*.md to pick up the next eligible task.
#
# Usage:
#   ./ralph.sh              # Run with defaults (10 iterations)
#   ./ralph.sh -n 20        # Run 20 iterations
#   ./ralph.sh -n 0         # Run until all tasks are DONE (unlimited)
#   ./ralph.sh -d 5         # 5-second delay between iterations
#   ./ralph.sh -v           # Verbose — stream Claude output to terminal
#   ./ralph.sh --dry-run    # Print what would happen without running
#   ./ralph.sh -t 600       # 10-minute timeout per iteration (default: 900)
# ============================================================================

MAX_ITERATIONS=10
DELAY=2
DRY_RUN=false
VERBOSE=false
ITER_TIMEOUT=""   # empty = auto-scale per task complexity
LOG_DIR=".ralph-logs"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TASKS_DIR="$PROJECT_DIR/docs/tasks"

# --- Ensure subprocesses can't hang on PG connections ---
export PGCONNECT_TIMEOUT=5

# --- Colors ---
BOLD='\033[1m'
DIM='\033[2m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
RESET='\033[0m'

# --- Parse args ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    -n|--iterations) MAX_ITERATIONS="$2"; shift 2 ;;
    -d|--delay)      DELAY="$2"; shift 2 ;;
    -t|--timeout)    ITER_TIMEOUT="$2"; shift 2 ;;
    -v|--verbose)    VERBOSE=true; shift ;;
    --dry-run)       DRY_RUN=true; shift ;;
    -h|--help)
      echo "Usage: ./ralph.sh [-n iterations] [-d delay_seconds] [-t timeout_seconds] [-v] [--dry-run]"
      echo ""
      echo "Options:"
      echo "  -n, --iterations  Max iterations (default: 10, 0 = unlimited)"
      echo "  -d, --delay       Seconds between iterations (default: 2)"
      echo "  -t, --timeout     Max seconds per iteration (default: 900)"
      echo "  -v, --verbose     Stream full Claude output to terminal"
      echo "  --dry-run         Print config and exit"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# --- Setup ---
mkdir -p "$PROJECT_DIR/$LOG_DIR"

# --- Helpers ---
timestamp() { date '+%Y-%m-%dT%H:%M:%S'; }
elapsed() { echo "$(( $(date +%s) - $1 ))"; }

fmt_duration() {
  local secs=$1
  if [[ $secs -lt 60 ]]; then
    echo "${secs}s"
  elif [[ $secs -lt 3600 ]]; then
    echo "$((secs / 60))m $((secs % 60))s"
  else
    echo "$((secs / 3600))h $((secs % 3600 / 60))m"
  fi
}

# Scan task files to find next eligible TODO task
get_next_task() {
  local todo_tasks=()
  for f in "$TASKS_DIR"/T-*.md; do
    [[ -f "$f" ]] || continue
    if grep -q '^\- \*\*Status\*\*: TODO' "$f" 2>/dev/null; then
      todo_tasks+=("$f")
    fi
  done

  for f in "${todo_tasks[@]}"; do
    local deps
    deps=$(grep '^\- \*\*Depends\*\*:' "$f" 2>/dev/null | sed 's/.*: //' || true)
    if [[ "$deps" == "(none)" || "$deps" == "none" || -z "$deps" ]]; then
      basename "$f" .md
      return
    fi
    # Check each dependency
    local all_met=true
    for dep in $(echo "$deps" | sed 's/,/ /g; s/  */ /g; s/^ //; s/ $//'); do
      local dep_file="$TASKS_DIR/${dep}.md"
      if [[ ! -f "$dep_file" ]] || ! grep -q '^\- \*\*Status\*\*: DONE' "$dep_file" 2>/dev/null; then
        all_met=false
        break
      fi
    done
    if $all_met; then
      basename "$f" .md
      return
    fi
  done
  echo "none"
}

# Determine complexity tier for a task file → light, standard, or heavy
# Tiers: light (50 turns, 600s), standard (75 turns, 900s), heavy (125 turns, 1200s)
compute_task_complexity() {
  local task_file="$TASKS_DIR/${1}.md"
  [[ -f "$task_file" ]] || { echo "standard"; return; }

  # Count dependencies
  local deps_line
  deps_line=$(grep '^\- \*\*Depends\*\*:' "$task_file" 2>/dev/null | sed 's/.*: //' || true)
  local dep_count=0
  if [[ -n "$deps_line" && "$deps_line" != "none" && "$deps_line" != "(none)" ]]; then
    dep_count=$(echo "$deps_line" | tr ',' '\n' | sed '/^$/d' | wc -l | xargs)
  fi

  # Count produces (lines starting with - under ## Produces)
  local produce_count=0
  produce_count=$(sed -n '/^## Produces/,/^##/p' "$task_file" 2>/dev/null | grep -c '^\- ' || echo 0)

  # Check for integration keywords in title/description
  local has_keyword=false
  if head -20 "$task_file" 2>/dev/null | grep -qiE '(integration|end-to-end|e2e|refactor)'; then
    has_keyword=true
  fi

  # Determine tier
  if $has_keyword || [[ "$dep_count" -ge 4 ]] || [[ "$produce_count" -ge 5 ]]; then
    echo "heavy"
  elif [[ "$dep_count" -ge 2 ]] || [[ "$produce_count" -ge 3 ]]; then
    echo "standard"
  else
    echo "light"
  fi
}

count_tasks_by_status() {
  local status="$1"
  local count=0
  for f in "$TASKS_DIR"/T-*.md; do
    [[ -f "$f" ]] || continue
    if grep -q "^\- \*\*Status\*\*: ${status}" "$f" 2>/dev/null; then
      count=$((count + 1))
    fi
  done
  echo "$count"
}

all_tasks_done() {
  [[ "$(count_tasks_by_status TODO)" -eq 0 ]]
}

# Monitor the JSON stream log and print activity indicators
monitor_progress() {
  local log_file="$1"
  local pid="$2"
  local last_lines=0
  local last_activity
  last_activity=$(date +%s)
  local last_tool=""

  while kill -0 "$pid" 2>/dev/null; do
    if [[ -f "$log_file" ]]; then
      local current_lines
      current_lines=$(wc -l < "$log_file" 2>/dev/null || echo 0)
      current_lines=$(echo "$current_lines" | xargs)

      if [[ "$current_lines" -gt "$last_lines" ]]; then
        last_activity=$(date +%s)
        local new_count=$((current_lines - last_lines))

        # Read only the new lines from the JSON stream
        local new_lines
        new_lines=$(tail -n "$new_count" "$log_file" 2>/dev/null || true)

        # Detect tool use from JSON stream
        local tool_name
        tool_name=$(echo "$new_lines" | grep -o '"tool_name":"[^"]*"' | tail -1 | sed 's/"tool_name":"//;s/"//' || true)
        if [[ -n "$tool_name" && "$tool_name" != "$last_tool" ]]; then
          last_tool="$tool_name"
          case "$tool_name" in
            Write|Edit)
              local file_path
              file_path=$(echo "$new_lines" | grep -o '"file_path":"[^"]*"' | tail -1 | sed 's/"file_path":"//;s/"//' || true)
              if [[ -n "$file_path" ]]; then
                file_path=$(basename "$file_path")
                printf "\n  ${DIM}[%s]${RESET} ${CYAN}%s${RESET} %s" "$(timestamp)" "$tool_name" "$file_path"
              else
                printf "\n  ${DIM}[%s]${RESET} ${CYAN}%s${RESET}" "$(timestamp)" "$tool_name"
              fi
              ;;
            Read|Glob|Grep)
              printf "\n  ${DIM}[%s]${RESET} ${DIM}%s${RESET}" "$(timestamp)" "$tool_name"
              ;;
            Bash)
              local cmd_hint
              cmd_hint=$(echo "$new_lines" | grep -o '"command":"[^"]*"' | tail -1 | sed 's/"command":"//;s/"//' | cut -c1-60 || true)
              if echo "$cmd_hint" | grep -qi 'test\|vitest' 2>/dev/null; then
                printf "\n  ${DIM}[%s]${RESET} ${YELLOW}Running tests...${RESET}" "$(timestamp)"
              elif echo "$cmd_hint" | grep -qi 'git commit\|git push' 2>/dev/null; then
                printf "\n  ${DIM}[%s]${RESET} ${GREEN}Git: %s${RESET}" "$(timestamp)" "$cmd_hint"
              elif echo "$cmd_hint" | grep -qi 'pnpm\|npm\|turbo' 2>/dev/null; then
                printf "\n  ${DIM}[%s]${RESET} ${CYAN}%s${RESET}" "$(timestamp)" "$cmd_hint"
              else
                printf "\n  ${DIM}[%s]${RESET} ${DIM}$ %s${RESET}" "$(timestamp)" "$cmd_hint"
              fi
              ;;
            *)
              printf "\n  ${DIM}[%s]${RESET} %s" "$(timestamp)" "$tool_name"
              ;;
          esac
        fi

        # Detect assistant text messages (progress updates from Claude)
        local assistant_text
        assistant_text=$(echo "$new_lines" | grep '"type":"assistant"' | grep -o '"content":\[{"type":"text","text":"[^"]*"' | sed 's/.*"text":"//;s/"//' | tail -1 || true)
        if [[ -n "$assistant_text" && ${#assistant_text} -gt 10 && ${#assistant_text} -lt 200 ]]; then
          printf "\n  ${DIM}[%s] Claude: %s${RESET}" "$(timestamp)" "$assistant_text"
        fi

        # Detect errors
        if echo "$new_lines" | grep -q '"type":"error"' 2>/dev/null; then
          local error_msg
          error_msg=$(echo "$new_lines" | grep '"type":"error"' | grep -o '"message":"[^"]*"' | sed 's/"message":"//;s/"//' | tail -1 || true)
          printf "\n  ${RED}[%s] Error: %s${RESET}" "$(timestamp)" "$error_msg"
        fi

        last_lines=$current_lines
      else
        # No new output — show idle warning after 60s
        local idle_secs=$(( $(date +%s) - last_activity ))
        if [[ $idle_secs -gt 60 && $((idle_secs % 60)) -lt 6 ]]; then
          printf "\n  ${YELLOW}[%s] Idle for %s...${RESET}" "$(timestamp)" "$(fmt_duration $idle_secs)"
        fi
      fi
    fi
    sleep 3
  done
}

# Print a summary of what changed during an iteration
print_iteration_summary() {
  local log_file="$1"
  local start_time="$2"
  local duration
  duration=$(fmt_duration "$(elapsed "$start_time")")

  echo ""
  echo -e "  ${DIM}────────────────────────────────────────${RESET}"
  echo -e "  ${DIM}Duration:${RESET} $duration"

  # Log file size
  if [[ -f "$log_file" ]]; then
    local size
    size=$(wc -c < "$log_file" | xargs)
    local lines
    lines=$(wc -l < "$log_file" | xargs)
    echo -e "  ${DIM}Log:${RESET} $lines lines ($size bytes)"
  fi

  # New git commits
  local new_commits
  new_commits=$(git -C "$PROJECT_DIR" log --oneline --since="@${start_time}" 2>/dev/null || true)
  if [[ -n "$new_commits" ]]; then
    echo -e "  ${GREEN}Commits:${RESET}"
    echo "$new_commits" | while IFS= read -r line; do
      echo -e "    ${GREEN}$line${RESET}"
    done
  else
    echo -e "  ${YELLOW}Commits: (none)${RESET}"
  fi

  # Files changed in last commit
  local changed_files
  changed_files=$(git -C "$PROJECT_DIR" diff --name-only HEAD~1 HEAD 2>/dev/null | head -15 || true)
  if [[ -n "$changed_files" ]]; then
    local file_count
    file_count=$(echo "$changed_files" | wc -l | xargs)
    echo -e "  ${DIM}Files changed: $file_count${RESET}"
    echo "$changed_files" | while IFS= read -r f; do
      echo -e "    ${DIM}$f${RESET}"
    done
  fi

  # Iteration cost
  if [[ -f "$PROJECT_DIR/scripts/calc-cost.sh" && -f "$log_file" ]]; then
    local cost_result
    cost_result=$(bash "$PROJECT_DIR/scripts/calc-cost.sh" "$log_file" 2>/dev/null | tail -1 || true)
    if [[ -n "$cost_result" ]]; then
      local cost_amount
      cost_amount=$(echo "$cost_result" | grep -o '\$[0-9.]*' || true)
      [[ -n "$cost_amount" ]] && echo -e "  ${DIM}Cost:${RESET} ${cost_amount}"
    fi
  fi

  # Task progress
  local done_count remaining_count next
  done_count=$(count_tasks_by_status DONE)
  remaining_count=$(count_tasks_by_status TODO)
  next=$(get_next_task)
  echo -e "  ${CYAN}Progress: $done_count done, $remaining_count remaining | Next: $next${RESET}"
  echo -e "  ${DIM}────────────────────────────────────────${RESET}"
}

# Kill a process tree (process + all descendants)
kill_tree() {
  local pid="$1"
  local signal="${2:-TERM}"
  local children
  children=$(pgrep -P "$pid" 2>/dev/null || true)
  for child in $children; do
    kill_tree "$child" "$signal"
  done
  kill -"$signal" "$pid" 2>/dev/null || true
}

# --- Pre-flight checks ---
if ! command -v claude &>/dev/null; then
  echo -e "${RED}Error: 'claude' CLI not found. Install Claude Code first.${RESET}"
  exit 1
fi

if ! command -v docker &>/dev/null; then
  echo -e "${YELLOW}Warning: 'docker' not found. Database features will be unavailable.${RESET}"
fi

if [[ ! -d "$TASKS_DIR" ]]; then
  echo -e "${RED}Error: docs/tasks/ directory not found. Are you in the right project?${RESET}"
  exit 1
fi

# --- Ensure Docker Compose database is running ---
ensure_database() {
  if [[ ! -f "$PROJECT_DIR/docker-compose.yml" ]]; then
    echo -e "${YELLOW}[$(timestamp)] No docker-compose.yml yet — T-000 will create it.${RESET}"
    return 0
  fi

  echo -e "${CYAN}[$(timestamp)] Ensuring test database is running...${RESET}"
  if ! docker compose -f "$PROJECT_DIR/docker-compose.yml" up -d --wait 2>&1; then
    echo -e "${RED}[$(timestamp)] Failed to start database container. Check Docker.${RESET}"
    return 1
  fi
  echo -e "${GREEN}[$(timestamp)] Database container is healthy.${RESET}"
}

# --- Cleanup on exit ---
cleanup() {
  echo ""
  echo -e "${DIM}[$(timestamp)] Cleaning up...${RESET}"
  if [[ -f "$PROJECT_DIR/docker-compose.yml" ]]; then
    docker compose -f "$PROJECT_DIR/docker-compose.yml" down 2>/dev/null || true
  fi
}
trap 'cleanup; exit 0' INT TERM
trap cleanup EXIT

# --- Config summary ---
next_task=$(get_next_task)
done_count=$(count_tasks_by_status DONE)
todo_count=$(count_tasks_by_status TODO)

echo -e "${BOLD}=== Ralph Loop ===${RESET}"
echo -e "  Project:    $PROJECT_DIR"
echo -e "  Iterations: $([ "$MAX_ITERATIONS" -eq 0 ] && echo 'unlimited' || echo "$MAX_ITERATIONS")"
echo -e "  Delay:      ${DELAY}s between iterations"
echo -e "  Timeout:    $([ -n "$ITER_TIMEOUT" ] && echo "${ITER_TIMEOUT}s (override)" || echo "auto (light=600s, standard=900s, heavy=1200s)")"
echo -e "  Verbose:    $VERBOSE"
echo -e "  Logs:       $LOG_DIR/"
echo -e "  Next task:  $next_task"
echo -e "  Tasks:      ${GREEN}${done_count} done${RESET} | ${YELLOW}${todo_count} remaining${RESET}"
echo -e "${BOLD}==================${RESET}"

if $DRY_RUN; then
  echo "(dry run — exiting)"
  exit 0
fi

# --- Start database ---
ensure_database

# --- Clean slate: discard any unstaged changes from a crashed iteration ---
if ! git -C "$PROJECT_DIR" diff --quiet 2>/dev/null; then
  echo -e "${YELLOW}[$(timestamp)] Discarding unstaged changes from a previous crashed iteration:${RESET}"
  git -C "$PROJECT_DIR" diff --name-only
  git -C "$PROJECT_DIR" checkout -- .
  echo -e "${GREEN}[$(timestamp)] Clean slate restored.${RESET}"
fi

# Push any unpushed commits from a previous run
if ! git -C "$PROJECT_DIR" diff --quiet origin/main..HEAD 2>/dev/null; then
  echo -e "${CYAN}[$(timestamp)] Pushing unpushed commits from a previous run...${RESET}"
  git -C "$PROJECT_DIR" push origin main
fi

# --- The Loop ---
loop_start=$(date +%s)
iteration=0
while true; do
  iteration=$((iteration + 1))

  # Check iteration limit
  if [[ "$MAX_ITERATIONS" -gt 0 && "$iteration" -gt "$MAX_ITERATIONS" ]]; then
    echo ""
    echo -e "${YELLOW}[$(timestamp)] Reached max iterations ($MAX_ITERATIONS). Stopping.${RESET}"
    break
  fi

  # Ensure database is still running before each iteration
  ensure_database || {
    echo -e "${RED}[$(timestamp)] Database unavailable — skipping iteration.${RESET}"
    sleep "$DELAY"
    continue
  }

  # Check if all tasks are done
  next_task=$(get_next_task)
  if all_tasks_done || [[ "$next_task" == "none" ]]; then
    echo ""
    echo -e "${GREEN}[$(timestamp)] All tasks are DONE. Ralph is finished.${RESET}"
    break
  fi

  # Scale turns and timeout based on task complexity (CLI flags override)
  task_tier=$(compute_task_complexity "$next_task")
  case "$task_tier" in
    light)    iter_max_turns=50;  iter_timeout=600  ;;
    heavy)    iter_max_turns=125; iter_timeout=1200 ;;
    *)        iter_max_turns=75;  iter_timeout=900  ;;
  esac
  [[ -n "$ITER_TIMEOUT" ]] && iter_timeout="$ITER_TIMEOUT"

  log_file="$PROJECT_DIR/$LOG_DIR/${next_task}-$(date '+%Y%m%d-%H%M%S').jsonl"
  iter_start=$(date +%s)

  echo ""
  echo -e "${BOLD}[$(timestamp)] === Iteration $iteration/$([ "$MAX_ITERATIONS" -eq 0 ] && echo '∞' || echo "$MAX_ITERATIONS") — Target: $next_task (${task_tier}: ${iter_max_turns} turns, ${iter_timeout}s) ===${RESET}"

  PROMPT="You are in Ralph Loop iteration $iteration. Follow the Ralph Methodology as defined in CLAUDE.md and docs/RALPH-METHODOLOGY.md.

PHASE LOGGING (MANDATORY): Before starting each phase, output a marker line EXACTLY like this:
  [PHASE] Entering: <phase name>
The phases in order are:
  1. Boot — reading task files, PRD, and existing code to understand the task
  2. Red — writing failing tests
  3. Green — implementing the minimum code to pass tests
  4. Verify — running pnpm check (lint, format, typecheck, build, test:coverage)
  5. Commit — staging files and committing
You MUST output the phase marker as plain text before doing any work in that phase. If you return to a phase (e.g. Red→Green→Red again), log it again.

WORKFLOW:
1. BOOT: Scan docs/tasks/ to find the next eligible task (lowest-numbered TODO with all deps DONE). Read the PRD sections it references.
2. EXECUTE: Implement using strict red/green TDD — write failing tests FIRST, then implement the minimum to pass. Run 'pnpm check' after each layer (types, planner, tests, etc.) — do NOT wait until the end. Catch errors early.
3. QUALITY GATES (mandatory before commit):
   - Every line of production code must be exercised by a test. No untested code.
   - No code smells: no dead code, no commented-out blocks, no TODO/FIXME/HACK, no duplication.
   - No security vulnerabilities (SQL injection, command injection, hardcoded secrets, etc.).
   - Run 'pnpm check' (lint, format, typecheck, build, test:coverage) — must pass clean.
4. COMMIT: ONE commit per task. Message format 'T-NNN: description'. No Claude attribution. The task file update (Status→DONE, Completed timestamp, Commit SHA, Completion Notes) MUST be in the SAME commit as the code — never a separate commit. Stage everything, commit once.
5. TOOL USAGE (STRICT — violations will terminate this iteration):
   - Read files: ALWAYS use the Read tool. NEVER use cat, head, tail, or sed to read files.
   - Search code: ALWAYS use Grep or Glob tools. NEVER use grep, find, or ls in Bash.
   - The ONLY acceptable Bash uses are: git, pnpm, docker, and commands with no dedicated tool.
   - This is enforced automatically. Exceeding 10 shell-read violations kills the iteration.
6. BASH TIMEOUTS: When running pnpm, vitest, or any build/test command via Bash, set timeout to at least 120000ms (120 seconds). TypeScript compilation and test suites need time. Never use 30000ms or less for test/build commands.
7. Do NOT push to origin — the loop handles that. If blocked, note the blocker in the task file and exit.
8. Complete ONE task, then STOP. Do not start a second task in the same iteration."

  timed_out=false

  if $VERBOSE; then
    claude --print \
         --verbose \
         --output-format stream-json \
         --max-turns "$iter_max_turns" \
         --dangerously-skip-permissions \
         "$PROMPT" 2>&1 | tee "$log_file" &
    claude_pid=$!
  else
    claude --print \
         --verbose \
         --output-format stream-json \
         --max-turns "$iter_max_turns" \
         --dangerously-skip-permissions \
         "$PROMPT" \
         > "$log_file" 2>&1 &
    claude_pid=$!

    echo -e "  ${DIM}PID: $claude_pid | Log: $log_file${RESET}"

    # Start progress monitor
    monitor_progress "$log_file" "$claude_pid" &
    monitor_pid=$!
  fi

  # Timeout watchdog: kill claude if it exceeds iter_timeout
  (
    sleep "$iter_timeout"
    if kill -0 "$claude_pid" 2>/dev/null; then
      echo -e "\n  ${RED}[$(date '+%Y-%m-%dT%H:%M:%S')] TIMEOUT — killing iteration after ${iter_timeout}s${RESET}"
      kill_tree "$claude_pid" TERM
      sleep 5
      kill_tree "$claude_pid" KILL 2>/dev/null || true
    fi
  ) &
  watchdog_pid=$!

  # Commit detector: kill claude after it commits (one task per iteration)
  (
    local commit_before
    commit_before=$(git -C "$PROJECT_DIR" rev-parse HEAD 2>/dev/null || echo "none")
    while kill -0 "$claude_pid" 2>/dev/null; do
      sleep 5
      local commit_now
      commit_now=$(git -C "$PROJECT_DIR" rev-parse HEAD 2>/dev/null || echo "none")
      if [[ "$commit_now" != "$commit_before" ]]; then
        # A new commit landed — give Claude a few seconds to finish task file updates
        sleep 10
        if kill -0 "$claude_pid" 2>/dev/null; then
          echo -e "\n  ${CYAN}[$(date '+%Y-%m-%dT%H:%M:%S')] Commit detected — ending iteration (one task per iteration).${RESET}"
          kill_tree "$claude_pid" TERM
          sleep 5
          kill_tree "$claude_pid" KILL 2>/dev/null || true
        fi
        break
      fi
    done
  ) &
  commit_detector_pid=$!

  # Shell anti-pattern detector: kill iteration if Claude wastes too many turns
  # on cat/head/tail/grep/find instead of using dedicated Read/Grep/Glob tools
  (
    local anti_pattern_threshold=10
    while kill -0 "$claude_pid" 2>/dev/null; do
      sleep 15
      [[ -f "$log_file" ]] || continue
      local count
      count=$(grep -ao '"command":"[^"]*"' "$log_file" 2>/dev/null | grep -cE '(cat |head |tail |grep |find )' || echo 0)
      if [[ "$count" -ge "$anti_pattern_threshold" ]]; then
        if kill -0 "$claude_pid" 2>/dev/null; then
          echo -e "\n  ${YELLOW}[$(date '+%Y-%m-%dT%H:%M:%S')] Shell anti-pattern limit hit (${count} cat/head/tail/grep/find calls) — killing iteration to save context.${RESET}"
          kill_tree "$claude_pid" TERM
          sleep 5
          kill_tree "$claude_pid" KILL 2>/dev/null || true
        fi
        break
      fi
    done
  ) &
  antipattern_pid=$!

  # Wait for Claude to finish
  if wait "$claude_pid" 2>/dev/null; then
    kill "$watchdog_pid" 2>/dev/null || true; wait "$watchdog_pid" 2>/dev/null || true
    kill "$commit_detector_pid" 2>/dev/null || true; wait "$commit_detector_pid" 2>/dev/null || true
    kill "$antipattern_pid" 2>/dev/null || true; wait "$antipattern_pid" 2>/dev/null || true
    if ! $VERBOSE; then kill "$monitor_pid" 2>/dev/null || true; wait "$monitor_pid" 2>/dev/null || true; fi
    echo ""
    echo -e "${GREEN}[$(timestamp)] Iteration $iteration completed successfully.${RESET}"
  else
    exit_code=$?
    kill "$watchdog_pid" 2>/dev/null || true; wait "$watchdog_pid" 2>/dev/null || true
    kill "$commit_detector_pid" 2>/dev/null || true; wait "$commit_detector_pid" 2>/dev/null || true
    kill "$antipattern_pid" 2>/dev/null || true; wait "$antipattern_pid" 2>/dev/null || true
    if ! $VERBOSE; then kill "$monitor_pid" 2>/dev/null || true; wait "$monitor_pid" 2>/dev/null || true; fi
    echo ""
    if [[ $exit_code -eq 137 || $exit_code -eq 143 ]]; then
      # Check if Claude was killed after committing (commit detector) vs timeout
      local head_now
      head_now=$(git -C "$PROJECT_DIR" rev-parse HEAD 2>/dev/null || echo "none")
      local head_before
      head_before=$(git -C "$PROJECT_DIR" log --oneline --since="@${iter_start}" -1 2>/dev/null || true)
      if [[ -n "$head_before" ]]; then
        echo -e "${GREEN}[$(timestamp)] Iteration $iteration completed (terminated after commit).${RESET}"
      else
        timed_out=true
        echo -e "${RED}[$(timestamp)] Iteration $iteration TIMED OUT after $(fmt_duration "$iter_timeout").${RESET}"
      fi
    else
      echo -e "${RED}[$(timestamp)] Iteration $iteration exited with code $exit_code.${RESET}"
      if [[ $exit_code -gt 1 ]]; then
        echo -e "${RED}  Possible crash — continuing anyway.${RESET}"
      fi
    fi
  fi

  # If timed out, discard any partial work
  if $timed_out; then
    echo -e "${YELLOW}[$(timestamp)] Discarding partial work from timed-out iteration...${RESET}"
    git -C "$PROJECT_DIR" checkout -- . 2>/dev/null || true
    git -C "$PROJECT_DIR" clean -fd --exclude=node_modules --exclude=.ralph-logs --exclude=.env 2>/dev/null || true
  fi

  # Print iteration summary
  print_iteration_summary "$log_file" "$iter_start"

  # Backfill commit SHAs and regenerate milestones index
  if [[ -f "$PROJECT_DIR/scripts/update-shas.sh" ]]; then
    bash "$PROJECT_DIR/scripts/update-shas.sh" 2>/dev/null || true
  fi
  if [[ -f "$PROJECT_DIR/scripts/calc-cost.sh" ]]; then
    bash "$PROJECT_DIR/scripts/calc-cost.sh" --update-tasks 2>/dev/null || true
  fi
  git -C "$PROJECT_DIR" add docs/tasks/T-*.md 2>/dev/null || true
  if [[ -f "$PROJECT_DIR/scripts/update-milestones.sh" ]]; then
    bash "$PROJECT_DIR/scripts/update-milestones.sh" 2>/dev/null || true
    git -C "$PROJECT_DIR" add docs/MILESTONES.md 2>/dev/null || true
  fi
  git -C "$PROJECT_DIR" diff --cached --quiet 2>/dev/null || \
    git -C "$PROJECT_DIR" commit -m "Update task metadata" --no-verify 2>/dev/null || true

  # Push any unpushed commits
  if ! git -C "$PROJECT_DIR" diff --quiet origin/main..HEAD 2>/dev/null; then
    echo -e "${CYAN}[$(timestamp)] Pushing commits to origin...${RESET}"
    git -C "$PROJECT_DIR" push origin main
  fi

  # Brief delay
  sleep "$DELAY"
done

# --- Final Summary ---
total_duration=$(fmt_duration "$(elapsed "$loop_start")")
done_count=$(count_tasks_by_status DONE)
todo_count=$(count_tasks_by_status TODO)
echo ""
echo -e "${BOLD}=== Ralph Loop Complete ===${RESET}"
echo -e "  Iterations:      $iteration"
echo -e "  Total time:      $total_duration"
echo -e "  Tasks completed: ${GREEN}${done_count}${RESET}"
echo -e "  Tasks remaining: ${YELLOW}${todo_count}${RESET}"
echo -e "  Next task:       $(get_next_task)"
echo -e "  Logs: $LOG_DIR/"
echo -e "${BOLD}==========================${RESET}"
