#!/usr/bin/env bash
set -euo pipefail

# calc-cost.sh — Calculate token usage and estimated cost from a ralph log.
#
# Usage:
#   ./scripts/calc-cost.sh <logfile>           # single log
#   ./scripts/calc-cost.sh --task T-060        # all logs for a task
#   ./scripts/calc-cost.sh --all               # all logs, summary
#   ./scripts/calc-cost.sh --total             # grand total only
#
# Pricing (per million tokens, Claude Opus 4):
#   Input:        $15.00
#   Cache write:   $18.75
#   Cache read:    $1.50
#   Output:       $75.00

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$PROJECT_DIR/.ralph-logs"

# Pricing per token (using awk-friendly decimals)
# Opus 4: $15/M input, $18.75/M cache write, $1.50/M cache read, $75/M output
INPUT_RATE="0.000015"
CACHE_WRITE_RATE="0.00001875"
CACHE_READ_RATE="0.0000015"
OUTPUT_RATE="0.000075"

calc_log() {
  local log="$1"
  [[ -f "$log" ]] || return

  # Sum all usage fields across the log
  local input cache_write cache_read output
  input=$(grep -ao '"input_tokens":[0-9]*' "$log" 2>/dev/null | grep -o '[0-9]*' | awk '{s+=$1} END {print s+0}')
  cache_write=$(grep -ao '"cache_creation_input_tokens":[0-9]*' "$log" 2>/dev/null | grep -o '[0-9]*' | awk '{s+=$1} END {print s+0}')
  cache_read=$(grep -ao '"cache_read_input_tokens":[0-9]*' "$log" 2>/dev/null | grep -o '[0-9]*' | awk '{s+=$1} END {print s+0}')
  output=$(grep -ao '"output_tokens":[0-9]*' "$log" 2>/dev/null | grep -o '[0-9]*' | awk '{s+=$1} END {print s+0}')

  local cost
  cost=$(awk "BEGIN {printf \"%.4f\", ($input * $INPUT_RATE) + ($cache_write * $CACHE_WRITE_RATE) + ($cache_read * $CACHE_READ_RATE) + ($output * $OUTPUT_RATE)}")

  echo "$input|$cache_write|$cache_read|$output|$cost"
}

format_tokens() {
  local n="$1"
  if [[ $n -ge 1000000 ]]; then
    awk "BEGIN {printf \"%.1fM\", $n/1000000}"
  elif [[ $n -ge 1000 ]]; then
    awk "BEGIN {printf \"%.1fK\", $n/1000}"
  else
    echo "$n"
  fi
}

print_row() {
  local label="$1" input="$2" cache_write="$3" cache_read="$4" output="$5" cost="$6"
  printf "%-28s %8s %8s %8s %8s  \$%s\n" \
    "$label" \
    "$(format_tokens "$input")" \
    "$(format_tokens "$cache_write")" \
    "$(format_tokens "$cache_read")" \
    "$(format_tokens "$output")" \
    "$cost"
}

print_header() {
  printf "%-28s %8s %8s %8s %8s  %s\n" "" "Input" "CacheW" "CacheR" "Output" "Cost"
  printf "%-28s %8s %8s %8s %8s  %s\n" "" "-----" "------" "------" "------" "----"
}

# --- Main ---

if [[ $# -eq 0 ]]; then
  echo "Usage: calc-cost.sh <logfile> | --task T-NNN | --all | --total"
  exit 1
fi

case "$1" in
  --task)
    task="${2:?Missing task ID}"
    logs=$(ls "$LOG_DIR"/${task}-*.jsonl 2>/dev/null || true)
    [[ -z "$logs" ]] && { echo "No logs for $task"; exit 1; }

    print_header
    total_input=0 total_cw=0 total_cr=0 total_output=0 total_cost="0"
    attempt=0
    for log in $logs; do
      attempt=$((attempt + 1))
      result=$(calc_log "$log")
      IFS='|' read -r input cw cr output cost <<< "$result"
      print_row "${task} #${attempt}" "$input" "$cw" "$cr" "$output" "$cost"
      total_input=$((total_input + input))
      total_cw=$((total_cw + cw))
      total_cr=$((total_cr + cr))
      total_output=$((total_output + output))
      total_cost=$(awk "BEGIN {printf \"%.4f\", $total_cost + $cost}")
    done
    if [[ $attempt -gt 1 ]]; then
      printf "%-28s %8s %8s %8s %8s  %s\n" "" "" "" "" "" "------"
      print_row "TOTAL" "$total_input" "$total_cw" "$total_cr" "$total_output" "$total_cost"
    fi
    ;;

  --all|--total)
    # Group by task
    tmpfile=$(mktemp)
    sorted=$(mktemp)
    totals=$(mktemp)

    for log in "$LOG_DIR"/*.jsonl; do
      [[ -f "$log" ]] || continue
      task_id=$(basename "$log" | grep -oE 'T-[0-9]+' || echo "unknown")
      result=$(calc_log "$log")
      echo "${task_id}|${result}" >> "$tmpfile"
    done

    sort "$tmpfile" > "$sorted"

    if [[ "$1" == "--all" ]]; then
      print_header
    fi

    # Aggregate by task using awk (avoids subshell variable issues)
    awk -F'|' -v mode="$1" '
    function fmt(n) {
      if (n >= 1000000) return sprintf("%.1fM", n/1000000)
      else if (n >= 1000) return sprintf("%.1fK", n/1000)
      else return n
    }
    function row(label, i, cw, cr, o, c) {
      printf "%-28s %8s %8s %8s %8s  $%s\n", label, fmt(i), fmt(cw), fmt(cr), fmt(o), c
    }
    {
      if ($1 != prev && prev != "") {
        if (mode == "--all") {
          suffix = (attempts > 1) ? " (" attempts "x)" : ""
          row(prev suffix, ti, tcw, tcr, to, sprintf("%.4f", tc))
        }
        gi += ti; gcw += tcw; gcr += tcr; go += to; gc += tc
        ti = 0; tcw = 0; tcr = 0; to = 0; tc = 0; attempts = 0
      }
      prev = $1
      ti += $2; tcw += $3; tcr += $4; to += $5; tc += $6
      attempts++
    }
    END {
      if (prev != "") {
        if (mode == "--all") {
          suffix = (attempts > 1) ? " (" attempts "x)" : ""
          row(prev suffix, ti, tcw, tcr, to, sprintf("%.4f", tc))
        }
        gi += ti; gcw += tcw; gcr += tcr; go += to; gc += tc
        if (mode == "--all") {
          printf "%-28s %8s %8s %8s %8s  %s\n", "", "", "", "", "", "------"
        }
        row("GRAND TOTAL", gi, gcw, gcr, go, sprintf("%.4f", gc))
      }
    }' "$sorted"

    rm -f "$tmpfile" "$sorted" "$totals"
    ;;

  --update-tasks)
    # Write cost into each DONE task file
    TASKS_DIR="$PROJECT_DIR/docs/tasks"
    changed=0

    for task_file in "$TASKS_DIR"/T-*.md; do
      [[ -f "$task_file" ]] || continue
      grep -q '^\- \*\*Status\*\*: DONE' "$task_file" || continue

      task_id=$(basename "$task_file" .md)
      logs=$(ls "$LOG_DIR"/${task_id}-*.jsonl 2>/dev/null || true)
      [[ -z "$logs" ]] && continue

      # Sum cost across all iterations for this task
      task_cost="0"
      for log in $logs; do
        result=$(calc_log "$log")
        cost=$(echo "$result" | cut -d'|' -f5)
        task_cost=$(awk "BEGIN {printf \"%.2f\", $task_cost + $cost}")
      done

      formatted="\$${task_cost}"
      current=$(grep '^\- \*\*Cost\*\*:' "$task_file" | head -1 | sed 's/.*: *//' || true)

      if [[ "$current" == "$formatted" ]]; then
        continue
      fi

      if grep -q '^\- \*\*Cost\*\*:' "$task_file"; then
        sed -i '' "s/^- \*\*Cost\*\*:.*$/- **Cost**: ${formatted}/" "$task_file"
      elif grep -q '^\- \*\*Commit\*\*:' "$task_file"; then
        sed -i '' "/^\- \*\*Commit\*\*:/a\\
- **Cost**: ${formatted}" "$task_file"
      elif grep -q '^\- \*\*Completed\*\*:' "$task_file"; then
        sed -i '' "/^\- \*\*Completed\*\*:/a\\
- **Cost**: ${formatted}" "$task_file"
      else
        sed -i '' "/^\- \*\*Status\*\*: DONE/a\\
- **Cost**: ${formatted}" "$task_file"
      fi
      echo "Updated $task_id: ${formatted}"
      changed=$((changed + 1))
    done

    if [[ $changed -eq 0 ]]; then
      echo "All task costs up to date."
    else
      echo "Updated $changed task file(s)."
    fi
    ;;

  *)
    # Single log file
    [[ -f "$1" ]] || { echo "File not found: $1"; exit 1; }
    print_header
    result=$(calc_log "$1")
    IFS='|' read -r input cw cr output cost <<< "$result"
    print_row "$(basename "$1")" "$input" "$cw" "$cr" "$output" "$cost"
    ;;
esac
