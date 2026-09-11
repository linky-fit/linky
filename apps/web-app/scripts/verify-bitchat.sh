#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
export LINKY_BITCHAT_SOURCE="$(cd "${1:?Pass the BitChat Swift checkout path}" && pwd)"
expected_revision=9b84b361225facd8e623f25d76f889d3dc54a879
test "$(git -C "$LINKY_BITCHAT_SOURCE" rev-parse HEAD)" = "$expected_revision"
git -C "$LINKY_BITCHAT_SOURCE" diff --quiet HEAD -- localPackages/BitFoundation localPackages/BitLogger

verification_dir="$(mktemp -d "${TMPDIR:-/tmp}/linky-bitchat-verify.XXXXXX")"
trap 'rm -rf "$verification_dir"' EXIT
bun "$script_dir/bitchat/export.ts" "$verification_dir/outbound.txt"
swift run --package-path "$script_dir/bitchat" --scratch-path "$verification_dir/build" MeshVectors "$verification_dir/outbound.txt"
