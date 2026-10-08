#!/usr/bin/env bash
# Compiles the iOS BeaconCodec for the host and checks it against the shared beacon vectors.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
OUT_DIR="$(mktemp -d)"
trap 'rm -rf "$OUT_DIR"' EXIT

xcrun swiftc -parse-as-library -O \
  "$SCRIPT_DIR/../ios/App/App/BeaconCodec.swift" \
  "$SCRIPT_DIR/check-ios-beacon-codec.swift" \
  -o "$OUT_DIR/check-ios-beacon-codec"

"$OUT_DIR/check-ios-beacon-codec" "$REPO_ROOT/apps/web-app/src/app/lib/beaconVectors.json"
