#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# ralph-evolve.sh — Self-evolution loop
#
# Runs the ralph CLI on its own codebase in single-task mode, one task at a
# time. Each Claude session runs pnpm check (which includes build) during its
# Verify phase, so dist/ is already up to date when the iteration ends.
#
# Usage:
#   ./ralph-evolve.sh              # Run all remaining tasks
#   ./ralph-evolve.sh -n 5         # Run at most 5 tasks
#   ./ralph-evolve.sh -v           # Verbose — stream Claude output
#   ./ralph-evolve.sh --dry-run    # Print what would happen
# ============================================================================

MAX_TASKS=0  # 0 = unlimited
VERBOSE=false
DRY_RUN=false
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# --- Colors ---
BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
RESET='\033[0m'

# --- Parse args ---
RALPH_ARGS=(-n 1 --no-db)
while [[ $# -gt 0 ]]; do
  case "$1" in
    -n|--tasks)       MAX_TASKS="$2"; shift 2 ;;
    -v|--verbose)     VERBOSE=true; RALPH_ARGS+=(--verbose); shift ;;
    --dry-run)        DRY_RUN=true; shift ;;
    -h|--help)
      echo "Usage: ./ralph-evolve.sh [-n max_tasks] [-v] [--dry-run]"
      echo ""
      echo "Runs the ralph CLI on itself, one task per iteration."
      echo ""
      echo "Options:"
      echo "  -n, --tasks   Max tasks to complete (default: unlimited)"
      echo "  -v, --verbose Stream Claude output to terminal"
      echo "  --dry-run     Print plan and exit"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# --- Helpers ---
timestamp() { date '+%Y-%m-%dT%H:%M:%S'; }

fmt_duration() {
  local secs=$1
  if [[ $secs -lt 60 ]]; then echo "${secs}s"
  elif [[ $secs -lt 3600 ]]; then echo "$((secs / 60))m $((secs % 60))s"
  else echo "$((secs / 3600))h $((secs % 3600 / 60))m"
  fi
}

# --- Pre-flight ---
RALPH_BIN="$PROJECT_DIR/dist/ralph/bin.js"
if [[ ! -f "$RALPH_BIN" ]]; then
  echo -e "${CYAN}[$(timestamp)] Building ralph for the first time...${RESET}"
  pnpm --dir "$PROJECT_DIR" build
fi

# Quick dry-run via ralph to show config
echo -e "${BOLD}=== Ralph Self-Evolution ===${RESET}"
echo -e "  Project:   $PROJECT_DIR"
echo -e "  Max tasks: $([ "$MAX_TASKS" -eq 0 ] && echo 'unlimited' || echo "$MAX_TASKS")"
node "$RALPH_BIN" loop --dry-run "${RALPH_ARGS[@]}" 2>&1 | sed 's/^/  /'
echo -e "${BOLD}============================${RESET}"

if $DRY_RUN; then
  echo "(dry run — exiting)"
  exit 0
fi

# --- Evolution loop ---
completed=0
consecutive_failures=0
loop_start=$(date +%s)

while true; do
  if [[ "$MAX_TASKS" -gt 0 && "$completed" -ge "$MAX_TASKS" ]]; then
    echo -e "\n${YELLOW}[$(timestamp)] Reached task limit ($MAX_TASKS). Stopping.${RESET}"
    break
  fi

  # Check if any TODO tasks remain
  if ! grep -rq '^\- \*\*Status\*\*: TODO' "$PROJECT_DIR/docs/tasks/"T-*.md 2>/dev/null; then
    echo -e "\n${GREEN}[$(timestamp)] All tasks complete. Evolution finished.${RESET}"
    break
  fi

  completed=$((completed + 1))
  echo ""
  echo -e "${BOLD}[$(timestamp)] === Evolution step $completed ===${RESET}"

  # Run exactly one task via the ralph CLI
  if node "$RALPH_BIN" loop "${RALPH_ARGS[@]}"; then
    echo -e "${GREEN}[$(timestamp)] Step $completed completed.${RESET}"
    consecutive_failures=0
  else
    exit_code=$?
    consecutive_failures=$((consecutive_failures + 1))
    echo -e "${RED}[$(timestamp)] Step $completed failed (exit code $exit_code, failure $consecutive_failures/3).${RESET}"
    if [[ "$consecutive_failures" -ge 3 ]]; then
      echo -e "${RED}[$(timestamp)] 3 consecutive failures. Stopping.${RESET}"
      break
    fi
  fi
done

# --- Summary ---
elapsed=$(( $(date +%s) - loop_start ))
remaining=$(grep -rl '^\- \*\*Status\*\*: TODO' "$PROJECT_DIR/docs/tasks/"T-*.md 2>/dev/null | wc -l | xargs)
done_count=$(grep -rl '^\- \*\*Status\*\*: DONE' "$PROJECT_DIR/docs/tasks/"T-*.md 2>/dev/null | wc -l | xargs)

echo ""
echo -e "${BOLD}=== Evolution Complete ===${RESET}"
echo -e "  Steps run:  ${completed}"
echo -e "  Done:       ${GREEN}${done_count}${RESET}"
echo -e "  Remaining:  ${YELLOW}${remaining}${RESET}"
echo -e "  Total time: $(fmt_duration $elapsed)"
echo -e "${BOLD}=========================${RESET}"
