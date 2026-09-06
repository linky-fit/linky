# @linky/native-shell

Capacitor-based native shell for shipping the existing web app as:

- Android debug APK (side-by-side `fit.linky.app.debug`, "Linky Dev")
- Android release APK, published as `linky.apk` on GitHub Releases
- Android AAB, uploaded to the Google Play internal track by `.github/workflows/android-play-internal.yml`
- iOS project (no App Store release pipeline yet)

The shell consumes the bundled output from `apps/web-app/dist` and keeps the product UI in the web app package.

Java 17 is required for the Android Gradle plugin. On macOS, `scripts/with-java17.sh` resolves an installed JDK 17 before running Capacitor or Gradle.

Capacitor 7 generates Android compile options targeting Java 21, and some installed plugin Android modules do the same. `scripts/patch-android-java.sh` rewrites both back to Java 17 after `android:add` and `android:sync`.

## First-time setup

```bash
bun install
bun run native:android:add
bun run native:ios:add
```

## Android debug APK

```bash
bun run native:apk:debug
```

This builds `@linky/web-app`, syncs the Capacitor Android project (`android:prepare`), and runs `assembleDebug`.

The debug APK installs alongside the production app as the separate package `fit.linky.app.debug` and appears in the launcher as `Linky Dev`. Native FCM push works in it only when `android/app/google-services.json` contains a client for `fit.linky.app.debug`; otherwise the Google Services plugin is skipped for debug-only builds and push stays disabled.

The APK loads the bundled `apps/web-app/dist` files from inside the app. It does **not** use the Vite dev server unless you opt into live reload with `LINKY_CAP_SERVER_URL` (or `CAP_SERVER_URL`).

Output:

```bash
apps/native-shell/android/app/build/outputs/apk/debug/app-debug.apk
```

## Android release APK

Release APK builds use the same signing setup as the Play bundle build.

```bash
bun run native:apk:release
```

Output:

```bash
apps/native-shell/android/app/build/outputs/apk/release/app-release.apk
```

GitHub Releases publish the downloadable asset as `linky.apk`, so the public stable URL is:

```bash
https://github.com/hynek-jina/linky/releases/latest/download/linky.apk
```

## Android release AAB

Release builds derive Android `versionName` from the workspace version in the root `package.json` and `versionCode` from its components as `major * 10000 + minor * 100 + patch`.

Override either value for a specific build with:

```bash
export LINKY_ANDROID_VERSION_NAME=26.1.0
export LINKY_ANDROID_VERSION_CODE=260100
```

Release signing comes from `apps/native-shell/android/keystore.properties` (copy `keystore.properties.example` next to it and fill it in; see `docs/android-upload-key.md`) or from the equivalent environment variables:

```bash
export LINKY_UPLOAD_STORE_FILE=/absolute/path/to/linky-upload-key.jks
export LINKY_UPLOAD_STORE_PASSWORD=...
export LINKY_UPLOAD_KEY_ALIAS=...
export LINKY_UPLOAD_KEY_PASSWORD=...
```

`bun run native:android:release:check` verifies the signing config, `google-services.json`, and `keytool`. Then build the Play upload bundle:

```bash
bun run native:aab:release
```

Output:

```bash
apps/native-shell/android/app/build/outputs/bundle/release/app-release.aab
```

## Common commands

```bash
bun run native:android:sync
bun run native:android:open
bun run native:aab:release
bun run native:ios:sync
bun run native:ios:open
```

## Optional live reload

For local native debugging against a running Vite server, set one of these environment variables before `cap sync` / `cap open`:

```bash
export LINKY_CAP_SERVER_URL=http://127.0.0.1:5174
# or
export CAP_SERVER_URL=http://127.0.0.1:5174
```

If neither variable is set, the native shells use the bundled web assets.

## Native integrations

Android:

- Push: Capacitor Push Notifications + FCM with data-only messages rendered by `LinkyFirebaseMessagingService`, so closed-app notifications still show through the native shell. Requires `android/app/google-services.json`; without it the app skips push registration and notifications stay disabled.
- Encrypted secret storage for identity material (`LinkySecretStorageBridge`).
- Native QR scanning when WebKit camera APIs are unavailable.
- `nostr://` and `cashu://` URL handling forwarded to the web app, which resolves `nostr://npub...` into the saved contact (creating it when needed) and imports `cashu://cashu...` tokens into the wallet.
- NFC: reads NDEF URI and `text/plain` records carrying those schemes, and writes `cashu://cashu...` from token detail and `nostr://npub...` from the profile.

iOS: local Capacitor plugins for Keychain-backed secret storage, native QR scanning, and CoreNFC NDEF writing for the same payloads. Native notifications and deep links are not wired on iOS yet.
