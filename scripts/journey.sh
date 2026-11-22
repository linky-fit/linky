#!/usr/bin/env bash
# The journey-test stack of this checkout: every backend, the apps as production builds, the last releases
# beside them, and what a tester needs around a browser. Run by hand before a release; CI never runs it.
# The journey-testing skill says how to test with it.
#   bun run journey up                    build and start everything, then print the URLs
#   bun run journey urls                  the URLs again
#   bun run journey down                  stop the stack and drop its data, browser profiles and wallets
#   bun run journey logs [service...]     compose logs
#   bun run journey browser open <device> [chromium|webkit|firefox] [url]
#   bun run journey browser close|kill|delete <device>
#   bun run journey pw <device> <playwright-cli command...>
#   bun run journey inventory <device>    what the page's origin stores
#   bun run journey wallet <name> <command>           a Cashu wallet outside the apps; no command prints its usage
#   bun run journey ln invoice <sat>                  an invoice for an app to pay
#   bun run journey ln quote <id>                     whether that invoice was paid
#   bun run journey ln address <npub> <sat>           an invoice from a Lightning address of the stack
#   bun run journey mint hold|auto                    whether the main mint's invoices pay themselves
#   bun run journey bank pay <czk> <variable symbol>  book a transfer at the fake MONETA
#   bun run journey bitcoin <command>                 scripts/bitcoin-regtest.sh against this stack
set -euo pipefail

root=$(git rev-parse --show-toplevel)
name=$(basename "$root" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9_\n-' '-')
# Stable per checkout; set LINKY_JOURNEY_SLOT (1-100) when two checkouts land on the same ports.
slot=${LINKY_JOURNEY_SLOT:-$(($(printf %s "$root" | cksum | cut -d' ' -f1) % 100 + 1))}
port=$((30000 + slot * 20))
home=$root/.journey

latest_tag() { git -C "$root" tag -l "$1-v*" --sort=-v:refname | head -1; }
bun_version() { git -C "$root" show "$1:package.json" | sed -n 's/.*"packageManager": "bun@\(.*\)".*/\1/p'; }

export COMPOSE_PROJECT_NAME="$name-journey"
export LINKY_JOURNEY_ROOT=$root
export LINKY_JOURNEY_HOME=$home
export LINKY_JOURNEY_IMAGE="linky-journey-$name"
export LINKY_JOURNEY_HEAD_SHA=$(git -C "$root" rev-parse HEAD)
export LINKY_JOURNEY_BUN_VERSION=$(bun_version HEAD)
# Any ref works; the default is the last release of each app.
export LINKY_JOURNEY_LINKY_RELEASE=${LINKY_JOURNEY_LINKY_RELEASE:-$(latest_tag linky)}
export LINKY_JOURNEY_FAZOLE_RELEASE=${LINKY_JOURNEY_FAZOLE_RELEASE:-$(latest_tag fazole)}
export LINKY_JOURNEY_LINKY_RELEASE_SHA=$(git -C "$root" rev-parse "$LINKY_JOURNEY_LINKY_RELEASE^{commit}")
export LINKY_JOURNEY_FAZOLE_RELEASE_SHA=$(git -C "$root" rev-parse "$LINKY_JOURNEY_FAZOLE_RELEASE^{commit}")
export LINKY_JOURNEY_LINKY_RELEASE_BUN_VERSION=$(bun_version "$LINKY_JOURNEY_LINKY_RELEASE")
export LINKY_JOURNEY_FAZOLE_RELEASE_BUN_VERSION=$(bun_version "$LINKY_JOURNEY_FAZOLE_RELEASE")
export LINKY_JOURNEY_MINT_SELF_PAYS=$([ -e "$home/mint-hold" ] && echo false || echo true)

export LINKY_JOURNEY_LINKY_PORT=$port
export LINKY_JOURNEY_LINKY_RELEASE_PORT=$((port + 1))
export LINKY_JOURNEY_FAZOLE_PORT=$((port + 2))
export LINKY_JOURNEY_FAZOLE_RELEASE_PORT=$((port + 3))
export LINKY_JOURNEY_OPERATOR_PORT=$((port + 4))
export LINKY_JOURNEY_ERRORS_PORT=$((port + 5))
export LINKY_JOURNEY_PUSH_PORT=$((port + 6))
export LINKY_JOURNEY_BANK_PORT=$((port + 7))
export LINKY_E2E_NOSTR_PORT=$((port + 8))
export LINKY_E2E_EVOLU_PORT=$((port + 9))
export LINKY_E2E_MINT_PORT=$((port + 10))
export LINKY_E2E_TARGET_MINT_PORT=$((port + 11))
export LINKY_E2E_NPUBCASH_PORT=$((port + 12))
export LINKY_E2E_BITCOIND_PORT=$((port + 13))
export LINKY_E2E_ESPLORA_PORT=$((port + 14))
export LINKY_E2E_EXPLORER_PORT=$((port + 15))
export LINKY_JOURNEY_BLOSSOM_PORT=$((port + 16))
export LINKY_JOURNEY_NOSTR_RELAY_URL="ws://localhost:$LINKY_E2E_NOSTR_PORT"
export LINKSHU_MINT_URL="http://localhost:$LINKY_E2E_MINT_PORT"
target_mint="http://localhost:$LINKY_E2E_TARGET_MINT_PORT"

compose=(docker compose -f "$root/docker-compose.dev.yml" -f "$root/docker/journey/compose.yml"
  --profile integration --profile bitcoin)

urls() {
  printf '%-34s %s\n' \
    "Linky" "http://localhost:$LINKY_JOURNEY_LINKY_PORT" \
    "Linky $LINKY_JOURNEY_LINKY_RELEASE" "http://localhost:$LINKY_JOURNEY_LINKY_RELEASE_PORT" \
    "Fazole" "http://localhost:$LINKY_JOURNEY_FAZOLE_PORT" \
    "Fazole $LINKY_JOURNEY_FAZOLE_RELEASE" "http://localhost:$LINKY_JOURNEY_FAZOLE_RELEASE_PORT" \
    "On-chain operator console" "http://localhost:$LINKY_JOURNEY_OPERATOR_PORT" \
    "Error tracker" "http://localhost:$LINKY_JOURNEY_ERRORS_PORT" \
    "Nostr relay" "$LINKY_JOURNEY_NOSTR_RELAY_URL" \
    "Evolu relay" "ws://localhost:$LINKY_E2E_EVOLU_PORT" \
    "Main mint (self-pays: $LINKY_JOURNEY_MINT_SELF_PAYS)" "$LINKSHU_MINT_URL" \
    "Second mint" "$target_mint" \
    "Lightning addresses" "<npub>@localhost:$LINKY_E2E_NPUBCASH_PORT" \
    "Push service" "http://localhost:$LINKY_JOURNEY_PUSH_PORT" \
    "Fake MONETA" "http://localhost:$LINKY_JOURNEY_BANK_PORT" \
    "Blossom server" "https://localhost:$LINKY_JOURNEY_BLOSSOM_PORT" \
    "Block explorer" "http://localhost:$LINKY_E2E_EXPLORER_PORT"
}

# One browser profile per device; the session name stays short because playwright-cli puts it in a socket path.
pw() {
  local device=${1:?device}
  shift
  mkdir -p "$home/work/$device"
  (cd "$home/work/$device" && playwright-cli -s="j$slot-$device" "$@")
}

browser() {
  local action=${1:?open, close, kill or delete} device=${2:?device}
  local profile="$home/profiles/$device"
  case $action in
    open)
      local engine=${3:-$(cat "$profile.engine" 2>/dev/null || echo chromium)}
      mkdir -p "$profile"
      echo "$engine" >"$profile.engine"
      # Production hosts the apps would otherwise reach from localhost fail instead.
      # The stack's blossom server has a self-signed certificate. Chromium needs the flag as well,
      # because ignoreHTTPSErrors leaves out the service worker, which fetches the images.
      jq -n --arg engine "$engine" --arg profile "$profile" --argjson headless "$([ -n "${HEADED-}" ] && echo false || echo true)" \
        --argjson blocked "$(jq -R . "$root/scripts/journey/blocked-origins.txt" | jq -s .)" '{
          browser: {
            browserName: $engine,
            userDataDir: $profile,
            launchOptions: { headless: $headless, args: (if $engine == "chromium" then ["--ignore-certificate-errors"] else [] end) },
            contextOptions: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, ignoreHTTPSErrors: true }
          },
          network: { blockedOrigins: $blocked }
        }' >"$profile.json"
      pw "$device" open ${4:+"$4"} --config="$profile.json"
      ;;
    close) pw "$device" close ;;
    # A crash, as opposed to closing: nothing gets to flush.
    kill) pkill -9 -f -- "$profile" || true ;;
    delete)
      pw "$device" close >/dev/null 2>&1 || true
      pkill -9 -f -- "$profile" || true
      rm -rf "$profile" "$profile.engine" "$profile.json" "$home/work/$device"
      ;;
    *) echo "unknown browser action: $action" >&2 && exit 1 ;;
  esac
}

command=${1:-}
shift || true
case $command in
  up)
    for ref in "$LINKY_JOURNEY_LINKY_RELEASE" "$LINKY_JOURNEY_FAZOLE_RELEASE"; do
      [ -d "$home/src/$ref" ] && continue
      mkdir -p "$home/src/$ref"
      git -C "$root" archive "$ref" | tar -x -C "$home/src/$ref"
    done
    "${compose[@]}" up -d --build --wait
    bash "$root/scripts/bitcoin-regtest.sh" init
    urls
    ;;
  urls) urls ;;
  down)
    "${compose[@]}" down --volumes
    # Accounts and ecash of the dropped backends would mislead the next run.
    pkill -9 -f -- "$home/profiles/" || true
    rm -rf "$home/profiles" "$home/wallets" "$home/work" "$home/mint-hold"
    ;;
  logs) "${compose[@]}" logs "$@" ;;
  browser) browser "$@" ;;
  pw) pw "$@" ;;
  inventory) pw "${1:?device}" --raw run-code --filename="$root/scripts/journey/inventory.js" | jq 'fromjson? // .' ;;
  wallet) bun "$root/apps/linky-app/tests/journey/wallet.ts" "$@" ;;
  ln)
    case ${1:-} in
      # A quote at the second mint, so an app holding funds at the main mint pays it over Lightning.
      invoice)
        curl -sf -X POST "$target_mint/v1/mint/quote/bolt11" -H 'content-type: application/json' \
          -d "{\"amount\":${2:?sat},\"unit\":\"sat\"}" | jq -r '"quote \(.quote)\n\(.request)"'
        ;;
      quote) curl -sf "$target_mint/v1/mint/quote/bolt11/${2:?quote id}" | jq -r .state ;;
      address)
        callback=$(curl -sf "http://localhost:$LINKY_E2E_NPUBCASH_PORT/.well-known/lnurlp/${2:?npub}" | jq -r .callback)
        curl -sf "$callback?amount=$((${3:?sat} * 1000))" | jq -r .pr
        ;;
      *) echo "usage: bun run journey ln invoice <sat> | quote <id> | address <npub> <sat>" >&2 && exit 1 ;;
    esac
    ;;
  mint)
    case ${1:-} in
      hold) mkdir -p "$home" && touch "$home/mint-hold" && export LINKY_JOURNEY_MINT_SELF_PAYS=false ;;
      auto) rm -f "$home/mint-hold" && export LINKY_JOURNEY_MINT_SELF_PAYS=true ;;
      *) echo "usage: bun run journey mint hold|auto" >&2 && exit 1 ;;
    esac
    "${compose[@]}" up -d --wait cashu-mint
    ;;
  bank)
    [ "${1:-}" = pay ] || { echo "usage: bun run journey bank pay <czk> <variable symbol>" >&2 && exit 1; }
    curl -sf -X POST "http://localhost:$LINKY_JOURNEY_BANK_PORT/transfers" -H 'content-type: application/json' \
      -d "{\"amountCzk\":${2:?czk},\"vs\":\"${3:?variable symbol}\"}"
    ;;
  bitcoin) bash "$root/scripts/bitcoin-regtest.sh" "$@" ;;
  *) sed -n '2,/^set -euo/p' "$0" | sed '$d; s/^# \{0,1\}//' ;;
esac
