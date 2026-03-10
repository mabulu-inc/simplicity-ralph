#!/usr/bin/env bash
set -euo pipefail
trap 'exit 0' INT TERM

# ralph-monitor.sh — Minimal ralph status display with phase timeline.
#
# Usage:
#   ./scripts/ralph-monitor.sh           # one-shot status
#   ./scripts/ralph-monitor.sh -w        # watch mode (refresh every 5s)
#   ./scripts/ralph-monitor.sh -w -i 3   # watch mode, refresh every 3s

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TASKS_DIR="$PROJECT_DIR/docs/tasks"
LOG_DIR="$PROJECT_DIR/.ralph-logs"
WATCH=false
INTERVAL=5

GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

while [[ $# -gt 0 ]]; do
  case "$1" in
    -w|--watch)    WATCH=true; shift ;;
    -i|--interval) INTERVAL="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: ralph-monitor.sh [-w] [-i seconds]"
      exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

format_duration() {
  local secs="$1"
  if [[ $secs -lt 60 ]]; then
    echo "${secs}s"
  elif [[ $secs -lt 3600 ]]; then
    echo "$((secs / 60))m $((secs % 60))s"
  else
    echo "$((secs / 3600))h $((secs % 3600 / 60))m"
  fi
}

# Extract phase timeline from log file.
# Parses [PHASE] markers and correlates with log timestamps.
get_phase_timeline() {
  local log="$1"
  [[ -f "$log" ]] || return
  set +e

  # Get log creation time as baseline
  local log_birth
  log_birth=$(stat -f %B "$log" 2>/dev/null || stat -c %W "$log" 2>/dev/null || echo 0)
  [[ "$log_birth" -le 0 ]] && log_birth=$(stat -f %m "$log" 2>/dev/null || stat -c %Y "$log" 2>/dev/null || echo 0)

  local log_now
  log_now=$(stat -f %m "$log" 2>/dev/null || stat -c %Y "$log" 2>/dev/null || echo 0)

  local total_lines
  total_lines=$(wc -l < "$log" | xargs)
  [[ "$total_lines" -lt 1 ]] && { set -e; return; }

  local total_elapsed=$(( log_now - log_birth ))
  [[ $total_elapsed -lt 1 ]] && total_elapsed=1

  # Find all phase markers with their line numbers
  # Format: "line_number:phase_name"
  local phases
  phases=$(grep -an '\[PHASE\] Entering:' "$log" 2>/dev/null | sed 's/.*\[PHASE\] Entering: *//' || true)

  if [[ -z "$phases" ]]; then
    set -e
    return
  fi

  # Get line numbers for each phase
  local line_numbers
  line_numbers=$(grep -n '\[PHASE\] Entering:' "$log" 2>/dev/null | cut -d: -f1 || true)

  # Build arrays (bash 3.x compatible)
  local phase_count=0
  local tmpfile
  tmpfile=$(mktemp)

  paste <(echo "$line_numbers") <(echo "$phases") > "$tmpfile" 2>/dev/null || {
    # Fallback if paste fails
    local i=0
    while IFS= read -r p; do
      local ln
      ln=$(echo "$line_numbers" | sed -n "$((i+1))p")
      echo -e "${ln}\t${p}" >> "$tmpfile"
      i=$((i+1))
    done <<< "$phases"
  }

  local prev_line=0 prev_phase=""
  local now_ts
  now_ts=$(date +%s)
  local is_running
  is_running=$(pgrep -f "claude --print.*Ralph Loop" 2>/dev/null | head -1 || true)

  while IFS=$'\t' read -r line_num phase_name; do
    [[ -z "$line_num" || -z "$phase_name" ]] && continue

    # If there was a previous phase, calculate its duration and print it
    if [[ -n "$prev_phase" ]]; then
      local prev_start_secs=$(( (prev_line * total_elapsed) / total_lines ))
      local curr_start_secs=$(( (line_num * total_elapsed) / total_lines ))
      local dur=$(( curr_start_secs - prev_start_secs ))
      [[ $dur -lt 1 ]] && dur=1
      echo -e "  ${GREEN}✓${RESET} ${prev_phase}$(printf '%*s' $((20 - ${#prev_phase})) '')${DIM}$(format_duration $dur)${RESET}"
    fi

    prev_line=$line_num
    prev_phase="$phase_name"
    phase_count=$((phase_count + 1))
  done < "$tmpfile"
  rm -f "$tmpfile"

  # Print the current (last) phase
  if [[ -n "$prev_phase" ]]; then
    local prev_start_secs=$(( (prev_line * total_elapsed) / total_lines ))
    local dur=$(( total_elapsed - prev_start_secs ))
    [[ $dur -lt 0 ]] && dur=0

    if [[ -n "$is_running" ]]; then
      # Still in progress
      echo -e "  ${CYAN}▸${RESET} ${BOLD}${prev_phase}${RESET}$(printf '%*s' $((20 - ${#prev_phase})) '')${CYAN}$(format_duration $dur)${RESET}"
    else
      echo -e "  ${GREEN}✓${RESET} ${prev_phase}$(printf '%*s' $((20 - ${#prev_phase})) '')${DIM}$(format_duration $dur)${RESET}"
    fi
  fi

  set -e
}

render() {
  set +e
  local ralph_pid claude_pid active_log
  ralph_pid=$(pgrep -f "ralph.sh" 2>/dev/null | head -1 || true)
  claude_pid=$(pgrep -f "claude --print.*Ralph Loop" 2>/dev/null | head -1 || true)
  active_log=$(ls -t "$LOG_DIR"/*.jsonl 2>/dev/null | head -1)

  # Task counts
  local done_count=0 todo_count=0
  for f in "$TASKS_DIR"/T-*.md; do
    [[ -f "$f" ]] || continue
    if grep -q '^\- \*\*Status\*\*: DONE' "$f" 2>/dev/null; then
      done_count=$((done_count + 1))
    elif grep -q '^\- \*\*Status\*\*: TODO' "$f" 2>/dev/null; then
      todo_count=$((todo_count + 1))
    fi
  done
  local total=$((done_count + todo_count))
  local pct=0
  [[ $total -gt 0 ]] && pct=$(( (done_count * 100) / total ))

  # Progress bar
  local bar_width=20 filled=0
  [[ $total -gt 0 ]] && filled=$(( (done_count * bar_width) / total ))
  local bar=""
  for ((i=0; i<filled; i++)); do bar+="█"; done
  for ((i=filled; i<bar_width; i++)); do bar+="░"; done

  # Status
  local status status_color
  if [[ -n "$claude_pid" ]]; then
    status="RUNNING"
    status_color="$GREEN"
  elif [[ -n "$ralph_pid" ]]; then
    status="BETWEEN TASKS"
    status_color="$YELLOW"
  else
    status="STOPPED"
    status_color="$RED"
  fi

  # Current task
  local task="—" title=""
  if [[ -n "$active_log" ]]; then
    task=$(basename "$active_log" | grep -oE 'T-[0-9]+' || echo "—")
  fi
  if [[ "$task" != "—" && -f "$TASKS_DIR/${task}.md" ]]; then
    title=$(head -1 "$TASKS_DIR/${task}.md" | sed "s/^# ${task}: //")
  fi

  # Render
  $WATCH && clear

  echo -e "${BOLD}ralph${RESET}  ${status_color}${status}${RESET}"
  echo -e "${GREEN}${bar}${RESET} ${done_count}/${total} (${pct}%)"
  if [[ "$task" != "—" ]]; then
    echo -e "${CYAN}${task}${RESET} ${title}"
  fi
  echo ""

  # Phase timeline
  if [[ -n "$active_log" ]]; then
    get_phase_timeline "$active_log"
  fi

  $WATCH && echo -e "\n${DIM}Ctrl+C to exit${RESET}"
  set -e
}

if $WATCH; then
  while true; do
    render
    sleep "$INTERVAL"
  done
else
  render
fi
