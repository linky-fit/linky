#!/usr/bin/env bash
# Runs a Playwright suite against a Docker stack owned by this checkout, so worktrees can run e2e side by side.
#   bun run e2e [playwright args]       web-app suite (local-stack project)
#   bun run e2e site [playwright args]  site suite
#   bun run e2e down                    stop this checkout's stack and drop its data
set -euo pipefail

root=$(git rev-parse --show-toplevel)
name=$(basename "$root" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9_\n-' '-')
# Stable per checkout; set LINKY_E2E_SLOT (1-100) when two checkouts land on the same ports.
slot=${LINKY_E2E_SLOT:-$(($(printf %s "$root" | cksum | cut -d' ' -f1) % 100 + 1))}
port=$((20000 + slot * 10))

export COMPOSE_PROJECT_NAME="$name-e2e"
export LINKY_E2E_WEB_IMAGE="linky-web-app:$name"
export LINKY_E2E_SUPPORTER_IMAGE="linky-supporter:$name"
export LINKY_E2E_WEB_PORT=$port
export LINKY_E2E_NOSTR_PORT=$((port + 1))
export LINKY_E2E_EVOLU_PORT=$((port + 2))
export LINKY_E2E_EVOLU_QUOTA_PORT=$((port + 3))
export LINKY_E2E_MINT_PORT=$((port + 4))
export LINKY_E2E_TARGET_MINT_PORT=$((port + 5))
export LINKY_E2E_SITE_PORT=$((port + 6))
export LINKSHU_MINT_URL="http://localhost:$LINKY_E2E_MINT_PORT"
export LINKSHU_TARGET_MINT_URL="http://localhost:$LINKY_E2E_TARGET_MINT_PORT"

compose=(docker compose -f "$root/docker-compose.dev.yml" --profile e2e)
case "${1-}" in
  down) exec "${compose[@]}" down --volumes ;;
  site) shift && app=site ;;
  *) app=web-app && set -- --project=local-stack "$@" ;;
esac

# Layer caching makes this a no-op unless app code changed since the last build.
"${compose[@]}" up -d --build --wait
cd "$root/apps/$app"
exec bunx playwright test "$@"
