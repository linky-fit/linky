#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/.." && pwd)"
repo_root="$(cd "$root_dir/../.." && pwd)"

patch_file() {
  local file_path="$1"
  if [[ ! -f "$file_path" ]]; then
    return 0
  fi

  sed -i.bak -e 's/JavaVersion.VERSION_21/JavaVersion.VERSION_17/g' -e 's/jvmToolchain(21)/jvmToolchain(17)/g' "$file_path"
  rm -f "${file_path}.bak"
}

patch_file "$root_dir/android/app/capacitor.build.gradle"
patch_file "$root_dir/android/capacitor-cordova-android-plugins/build.gradle"
patch_file "$root_dir/node_modules/@capacitor/android/capacitor/build.gradle"
patch_file "$root_dir/node_modules/@capacitor/clipboard/android/build.gradle"
patch_file "$root_dir/node_modules/@capacitor/filesystem/android/build.gradle"
patch_file "$root_dir/node_modules/@capacitor/push-notifications/android/build.gradle"
patch_file "$root_dir/node_modules/@capacitor/share/android/build.gradle"

shopt -s nullglob
for file_path in "$repo_root"/node_modules/.bun/@capacitor+android@*/node_modules/@capacitor/android/capacitor/build.gradle; do
  patch_file "$file_path"
done
for file_path in "$repo_root"/node_modules/.bun/@capacitor+clipboard@*/node_modules/@capacitor/clipboard/android/build.gradle; do
  patch_file "$file_path"
done
for file_path in "$repo_root"/node_modules/.bun/@capacitor+filesystem@*/node_modules/@capacitor/filesystem/android/build.gradle; do
  patch_file "$file_path"
done
for file_path in "$repo_root"/node_modules/.bun/@capacitor+push-notifications@*/node_modules/@capacitor/push-notifications/android/build.gradle; do
  patch_file "$file_path"
done
for file_path in "$repo_root"/node_modules/.bun/@capacitor+share@*/node_modules/@capacitor/share/android/build.gradle; do
  patch_file "$file_path"
done
shopt -u nullglob
