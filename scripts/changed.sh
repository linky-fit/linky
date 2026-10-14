#!/usr/bin/env bash
# Runs workspace scripts only where this branch changed something, scoped like CI:
# a change outside apps/ reaches every workspace, a change to an app reaches it and the apps importing it.
#   bun run check-changed   typecheck, eslint, prettier
#   bun run test-changed    unit tests
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
base=$(git merge-base origin/main HEAD)
changed=$({ git diff --name-only "$base"; git ls-files --others --exclude-standard; } | sort -u)

if grep -qv '^apps/' <<< "$changed"; then
  scope=(--workspaces)
else
  scope=()
  for app in $(cut -d/ -f2 <<< "$changed" | sort -u); do
    [[ -f "apps/$app/package.json" ]] || continue
    name=$(bun -p "require('./apps/$app/package.json').name")
    for manifest in $(grep -l "\"$name\"" apps/*/package.json); do
      scope+=(--filter "./$(dirname "$manifest")")
    done
  done
fi

echo "Scope: ${scope[*]}"
for script in "$@"; do
  bun run "${scope[@]}" --if-present "$script"
done
