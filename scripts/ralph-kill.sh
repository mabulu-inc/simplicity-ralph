#!/usr/bin/env bash
# ralph-kill.sh — Force-stop ralph and all its child processes.

pids=$(pgrep -f "ralph.sh" 2>/dev/null)
pids+=" "$(pgrep -f "claude --print.*Ralph Loop" 2>/dev/null)
pids=$(echo "$pids" | xargs)

if [[ -z "$pids" ]]; then
  echo "Ralph is not running."
  exit 0
fi

echo "Killing PIDs: $pids"
kill -9 $pids 2>/dev/null
echo "Ralph stopped."
