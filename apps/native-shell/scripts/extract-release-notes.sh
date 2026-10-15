#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
  echo "Usage: [CHANGELOG=<path>] $0 <version-or-tag> <output-path> [locale]" >&2
  exit 1
fi

version="${1#*v}"
output_path="$2"
locale="${3:-}"
root_dir="$(cd "$(dirname "$0")/../../.." && pwd)"
changelog_path="${CHANGELOG:-$root_dir/apps/linky-app/CHANGELOG.md}"

if [[ ! -f "$changelog_path" ]]; then
  echo "Missing changelog: $changelog_path" >&2
  exit 1
fi

mkdir -p "$(dirname "$output_path")"

awk -v version="$version" -v locale="$locale" '
  BEGIN {
    version_header = "## [" version "]"
    locale_header = "### " locale
  }

  index($0, version_header) == 1 {
    in_version = 1
    next
  }

  in_version && /^## \[/ {
    exit
  }

  in_version && locale == "" {
    print
    next
  }

  in_version && locale != "" && $0 == locale_header {
    in_locale = 1
    next
  }

  in_locale && /^### / {
    exit
  }

  in_locale {
    print
  }

  END {
    if (!in_version) exit 2
    if (locale != "" && !in_locale) exit 3
  }
' "$changelog_path" > "$output_path" || {
  echo "Missing release notes for version $version${locale:+ and locale $locale}" >&2
  exit 1
}

if [[ ! -s "$output_path" ]]; then
  echo "Release notes for version $version${locale:+ and locale $locale} are empty" >&2
  exit 1
fi

if [[ -n "$locale" ]]; then
  character_count="$(wc -m < "$output_path" | tr -d '[:space:]')"
  if ((character_count > 500)); then
    echo "Release notes for $version and $locale exceed the Google Play limit: $character_count/500 characters" >&2
    exit 1
  fi
fi
