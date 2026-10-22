#!/usr/bin/env bash
# Drives the regtest bitcoind of docker-compose.dev.yml (profile `bitcoin`).
# Start it first with `bun run bitcoin:up`.
set -euo pipefail

cd "$(dirname "$0")/.."

DEV_WALLET=dev

usage() {
  cat <<'EOF'
Usage: bun run bitcoin -- <command>

  init                                 create/load the `dev` wallet, mine 101 blocks to it if it is empty
  mine <n> [address]                   mine n blocks (to a new `dev` address by default)
  send <address> <btc>                 pay from the `dev` wallet, prints the txid
  balance                              `dev` wallet balance in BTC
  newaddress [type]                    new `dev` address (default bech32m, i.e. bcrt1p...)
  import-descriptor <wallet> <desc>    create a descriptor wallet and import a private or public descriptor;
                                       a .../0/*) receive branch is imported with its /1/* change branch
  cli <args...>                        bitcoin-cli passthrough
EOF
}

cli() {
  docker compose -f docker-compose.dev.yml exec -T bitcoind \
    bitcoin-cli -regtest -rpcuser=linky -rpcpassword=linky "$@"
}

wallet_cli() {
  local wallet=$1
  shift
  cli -rpcwallet="$wallet" "$@"
}

# Loads the wallet, creating it with `create_args` (createwallet's positional
# arguments after the name) when it does not exist yet.
ensure_wallet() {
  local wallet=$1
  shift
  if cli listwallets | grep -q "\"$wallet\""; then
    return
  fi
  if cli listwalletdir | grep -q "\"name\": \"$wallet\""; then
    cli loadwallet "$wallet" true >/dev/null
  else
    cli createwallet "$wallet" "$@" >/dev/null
  fi
}

ensure_dev_wallet() {
  ensure_wallet "$DEV_WALLET" false false "" false true true
}

require_args() {
  local count=$1
  shift
  if [ $# -lt "$count" ]; then
    usage >&2
    exit 1
  fi
}

mine() {
  local blocks=$1
  local address=${2:-}
  if [ -z "$address" ]; then
    ensure_dev_wallet
    address=$(wallet_cli "$DEV_WALLET" getnewaddress "" bech32m)
  fi
  cli generatetoaddress "$blocks" "$address" >/dev/null
  local height
  height=$(cli getblockcount)
  wait_for_esplora "$height"
  echo "mined $blocks block(s) to $address, height $height"
}

# electrs polls bitcoind every few seconds; wait so callers see the blocks.
wait_for_esplora() {
  local height=$1
  for _ in $(seq 60); do
    if [ "$(curl -s http://localhost:3002/blocks/tip/height)" = "$height" ]; then
      return
    fi
    sleep 0.5
  done
  echo "electrs on :3002 did not reach height $height" >&2
  exit 1
}

import_descriptor() {
  local wallet=$1
  local descriptor=${2%%#*}
  # A receive branch alone leaves the wallet no change address to pay from.
  if [[ $descriptor == */0/\*\) ]]; then
    descriptor="${descriptor%/0/\*)}/<0;1>/*)"
  fi
  local info checksum disable_private_keys=true
  info=$(cli getdescriptorinfo "$descriptor")
  checksum=$(sed -n 's/.*"checksum": "\([^"]*\)".*/\1/p' <<<"$info")
  if grep -q '"hasprivatekeys": true' <<<"$info"; then
    disable_private_keys=false
  fi
  ensure_wallet "$wallet" "$disable_private_keys" true "" false true true

  local request="{\"desc\": \"$descriptor#$checksum\", \"timestamp\": 0"
  if grep -q '"isrange": true' <<<"$info"; then
    # Fixed range so a re-import covers the keypool the first one grew.
    request+=", \"active\": true, \"range\": [0, 9999]"
  fi
  wallet_cli "$wallet" importdescriptors "[$request}]"
}

subcommand=${1:-}
shift $(($# > 0 ? 1 : 0))

case "$subcommand" in
  init)
    ensure_dev_wallet
    if [ "$(wallet_cli "$DEV_WALLET" getbalance)" = "0.00000000" ]; then
      mine 101
    fi
    echo "dev wallet balance: $(wallet_cli "$DEV_WALLET" getbalance) BTC"
    ;;
  mine)
    require_args 1 "$@"
    mine "$@"
    ;;
  send)
    require_args 2 "$@"
    ensure_dev_wallet
    wallet_cli "$DEV_WALLET" sendtoaddress "$1" "$2"
    ;;
  balance)
    ensure_dev_wallet
    wallet_cli "$DEV_WALLET" getbalance
    ;;
  newaddress)
    ensure_dev_wallet
    wallet_cli "$DEV_WALLET" getnewaddress "" "${1:-bech32m}"
    ;;
  import-descriptor)
    require_args 2 "$@"
    import_descriptor "$1" "$2"
    ;;
  cli)
    cli "$@"
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac
