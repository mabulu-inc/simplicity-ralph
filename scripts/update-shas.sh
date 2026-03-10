#!/usr/bin/env bash
set -euo pipefail

# update-shas.sh — Backfill or correct commit SHAs in task files.
#
# Scans all DONE tasks, finds the matching "T-NNN:" commit in git log,
# and updates the Commit field. Fixes missing, stale, or misnamed fields.

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TASKS_DIR="$PROJECT_DIR/docs/tasks"

changed=0

for task_file in "$TASKS_DIR"/T-*.md; do
  [[ -f "$task_file" ]] || continue

  # Only process DONE tasks
  grep -q '^\- \*\*Status\*\*: DONE' "$task_file" || continue

  task_id=$(basename "$task_file" .md)

  # Find the commit for this task
  sha=$(git -C "$PROJECT_DIR" log --oneline --all | grep -E "^[a-f0-9]+ ${task_id}:" | head -1 | cut -d' ' -f1)
  [[ -z "$sha" ]] && continue

  # Check current state of the file
  current_sha=$(grep -E '^\- \*\*(Commit|Commit SHA)\*\*:' "$task_file" | head -1 | sed 's/.*: *//' || true)

  if [[ "$current_sha" == "$sha" ]]; then
    continue  # already correct
  fi

  if grep -q '^\- \*\*Commit SHA\*\*:' "$task_file"; then
    # Wrong field name — replace
    sed -i '' "s/^- \*\*Commit SHA\*\*:.*$/- **Commit**: ${sha}/" "$task_file"
    echo "Fixed $task_id: renamed field, SHA $sha"
    changed=$((changed + 1))
  elif grep -q '^\- \*\*Commit\*\*:' "$task_file"; then
    # Right field name, wrong SHA — update
    sed -i '' "s/^- \*\*Commit\*\*:.*$/- **Commit**: ${sha}/" "$task_file"
    echo "Fixed $task_id: updated SHA to $sha"
    changed=$((changed + 1))
  else
    # No commit field at all — add after Completed or Status
    if grep -q '^\- \*\*Completed\*\*:' "$task_file"; then
      sed -i '' "/^\- \*\*Completed\*\*:/a\\
- **Commit**: ${sha}" "$task_file"
    else
      sed -i '' "/^\- \*\*Status\*\*: DONE/a\\
- **Commit**: ${sha}" "$task_file"
    fi
    echo "Fixed $task_id: added SHA $sha"
    changed=$((changed + 1))
  fi
done

if [[ $changed -eq 0 ]]; then
  echo "All SHAs up to date."
else
  echo "Updated $changed task file(s)."
fi
