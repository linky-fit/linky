#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
native_dir="$(cd -- "$script_dir/.." && pwd)"
workspace_dir="$(cd -- "$native_dir/../.." && pwd)"
res_dir="$native_dir/android/app/src/main/res"
icon_source="$workspace_dir/apps/linky-app/public/icon.svg"

if ! command -v rsvg-convert >/dev/null 2>&1; then
  echo "rsvg-convert is required to generate Android icons." >&2
  exit 1
fi

densities=(mdpi hdpi xhdpi xxhdpi xxxhdpi)
legacy_sizes=(48 72 96 144 192)
foreground_sizes=(108 162 216 324 432)

temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT
round_source="$temp_dir/android-round-icon.svg"

{
  IFS= read -r svg_opening
  printf '%s\n' "$svg_opening"
  printf '%s\n' '  <circle cx="400" cy="400" r="400" fill="#ffffff" />'
  cat
} <"$icon_source" >"$round_source"

for index in "${!densities[@]}"; do
  density="${densities[$index]}"
  legacy_size="${legacy_sizes[$index]}"
  foreground_size="${foreground_sizes[$index]}"
  adaptive_content_size=$((foreground_size * 2 / 3))
  adaptive_offset=$(((foreground_size - adaptive_content_size) / 2))
  output_dir="$res_dir/mipmap-$density"

  rsvg-convert \
    --width "$legacy_size" \
    --height "$legacy_size" \
    --background-color "#ffffff" \
    --output "$output_dir/ic_launcher.png" \
    "$icon_source"

  rsvg-convert \
    --width "$legacy_size" \
    --height "$legacy_size" \
    --output "$output_dir/ic_launcher_round.png" \
    "$round_source"

  rsvg-convert \
    --width "$adaptive_content_size" \
    --height "$adaptive_content_size" \
    --left "$adaptive_offset" \
    --top "$adaptive_offset" \
    --page-width "$foreground_size" \
    --page-height "$foreground_size" \
    --output "$output_dir/ic_launcher_foreground.png" \
    "$icon_source"
done

echo "Android launcher icons generated from $icon_source"
