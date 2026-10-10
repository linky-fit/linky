#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/../../.." && pwd)
consumer=$(mktemp -d)
trap 'rm -rf "$consumer"' EXIT

cd "$root"
bun run build:npm
tarballs=()
for package in linkshu linkstr linkauth; do
  tarball=$(cd "packages/$package/dist" && npm pack --silent --pack-destination "$consumer")
  tarballs+=("$consumer/$tarball")
done
cp packages/config/npm/fixtures/* "$consumer/"
cd "$consumer"
npm install --ignore-scripts --no-audit --no-fund "${tarballs[@]}"
test ! -d node_modules/vitest
node --input-type=module -e 'import("./consumer.ts").then(({ checkConsumer }) => checkConsumer())'
npm install --save-dev --ignore-scripts --no-audit --no-fund typescript@5.9.3 @types/node@24.10.1 vitest@4.0.18 ws@8.21.3
./node_modules/.bin/tsc
./node_modules/.bin/vitest run testing.test.ts
node relay.mjs
bun build browser.ts --target browser --outfile browser.js
node "$root/packages/config/npm/check-browser.mjs" "$consumer/browser.js"
mkdir -p "$root/dist/npm"
cp "${tarballs[@]}" "$root/dist/npm/"
