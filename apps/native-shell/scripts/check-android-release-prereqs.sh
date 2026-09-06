#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/.." && pwd)"
android_dir="$root_dir/android"
keystore_properties_path="$android_dir/keystore.properties"
google_services_path="$android_dir/app/google-services.json"

failures=0

print_error() {
  echo "[android-release-check] $1" >&2
  failures=$((failures + 1))
}

print_ok() {
  echo "[android-release-check] $1"
}

if [[ -f "$keystore_properties_path" ]]; then
  print_ok "Found apps/native-shell/android/keystore.properties"

  store_file_path="$(sed -n 's/^storeFile=//p' "$keystore_properties_path" | tail -n 1)"
  key_alias_value="$(sed -n 's/^keyAlias=//p' "$keystore_properties_path" | tail -n 1)"

  if [[ -z "$store_file_path" ]]; then
    print_error "keystore.properties is missing storeFile=..."
  elif [[ "$store_file_path" == "/absolute/path/to/linky-upload-key.jks" ]]; then
    print_error "keystore.properties still uses the placeholder storeFile path from the example file"
  elif [[ ! -f "$store_file_path" ]]; then
    print_error "Keystore file not found at: $store_file_path"
  else
    print_ok "Found keystore file referenced by keystore.properties"
  fi

  if [[ -z "$key_alias_value" ]]; then
    print_error "keystore.properties is missing keyAlias=..."
  fi
else
  print_error "Missing apps/native-shell/android/keystore.properties"
  print_error "Copy apps/native-shell/android/keystore.properties.example to keystore.properties and fill it in, or set the LINKY_UPLOAD_* environment variables."
fi

if [[ -f "$google_services_path" ]]; then
  print_ok "Found apps/native-shell/android/app/google-services.json"
else
  print_error "Missing apps/native-shell/android/app/google-services.json"
  print_error "Android push notifications stay disabled without this Firebase config file."
fi

if command -v keytool >/dev/null 2>&1; then
  print_ok "Found keytool on PATH"
else
  print_error "Missing keytool on PATH"
  print_error "Install a JDK and make sure keytool is available before generating an upload key."
fi

if [[ $failures -gt 0 ]]; then
  echo "[android-release-check] Android release prerequisites are incomplete." >&2
  exit 1
fi

echo "[android-release-check] Android release prerequisites look ready."
