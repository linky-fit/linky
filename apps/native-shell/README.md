# @linky-fit/native-shell

Capacitor shell that bundles `apps/web-app/dist` and ships it as:

- Android debug APK (`fit.linky.app.debug`, "Linky Dev", installs next to the production app)
- Android release APK, published as `linky.apk` on GitHub Releases
- Android AAB, uploaded to Google Play internal and open testing by `.github/workflows/release-app.yml` (see [Play setup](../../docs/android-play-console.md))
- iOS project (no App Store release pipeline yet)

Android builds need JDK 17. The `native:*` scripts select it through `scripts/with-java17.sh` and run `scripts/patch-android-java.sh`, which rewrites the Java 21 compile options Capacitor 7 generates back to 17.

## First-time setup

```bash
bun install
bun run native:android:add
bun run native:ios:add
```

## Android debug APK

```bash
bun run native:apk:debug
# apps/native-shell/android/app/build/outputs/apk/debug/app-debug.apk
```

Native push works in the debug APK only when `android/app/google-services.json` has a client for `fit.linky.app.debug`. Otherwise the build skips the Google Services plugin and push stays disabled.

## Android release APK

Uses the signing setup from the AAB section below.

```bash
bun run native:apk:release
# apps/native-shell/android/app/build/outputs/apk/release/app-release.apk
```

GitHub Releases publish it at `https://github.com/linky-fit/linky/releases/latest/download/linky.apk`.

## Android release AAB

`versionName` is the workspace version from the root `package.json`. `versionCode` is `major * 10000 + minor * 100 + patch` locally; CI sets `LINKY_ANDROID_VERSION_CODE` to `200000100 + run_number`. Override either for one build:

```bash
export LINKY_ANDROID_VERSION_NAME=26.1.0
export LINKY_ANDROID_VERSION_CODE=260100
```

Signing comes from `android/keystore.properties` (copy `keystore.properties.example`, see [`docs/android-upload-key.md`](../../docs/android-upload-key.md)) or from these variables:

```bash
export LINKY_UPLOAD_STORE_FILE=/absolute/path/to/linky-upload-key.jks
export LINKY_UPLOAD_STORE_PASSWORD=...
export LINKY_UPLOAD_KEY_ALIAS=...
export LINKY_UPLOAD_KEY_PASSWORD=...
```

`bun run native:android:release:check` verifies the signing config, `google-services.json` and `keytool`. Then:

```bash
bun run native:aab:release
# apps/native-shell/android/app/build/outputs/bundle/release/app-release.aab
```

## Live updates

An Android shell keeps its web app current without a store update, the way the browser does through its service worker.

- `android:prepare` writes `native-runtime.json` into the web build: a hash of the tracked files in `android/`, `ios/`, `capacitor.config.ts` and the installed versions of the Capacitor packages. Any change there makes a new runtime.
- Each app release attaches `live-update-<runtime>.zip` and its signed manifest `live-update-<runtime>.json` to the GitHub release (`scripts/publish-live-update.ts`).
- The app fetches `releases/latest/download/live-update-<its runtime>.json`. A shell whose runtime the latest release no longer matches gets a 404 and stays on its current bundle until the store update arrives.
- A newer bundle with a valid signature and SHA-256 is unpacked into app storage and offered like a web update: applied right away on a fresh untouched launch, otherwise from the update banner, never in the middle of wallet work.
- The switch is not persisted until the new bundle mounts, so a bundle that fails to boot is dropped on the next launch and not offered again. Installing a new APK goes back to the bundle inside it.

Release CI signs with the `LIVE_UPDATE_SIGNING_KEY` secret, the hex Ed25519 key matching `LIVE_UPDATE_PUBLIC_KEY` in `apps/web-app/src/platform/liveUpdateManifest.ts`; the script refuses a key that doesn't match. Rotating it means changing both in one release; installed shells reject that release's manifest and pick it up from the store, as with a native change.

iOS doesn't expose its runtime yet, so it gets no live updates.

## Common commands

```bash
bun run native:android:sync
bun run native:android:open
bun run native:ios:sync
bun run native:ios:open
```

## Live reload

To load a running Vite server instead of the bundled assets, set one of these before `sync` or `open`:

```bash
export LINKY_CAP_SERVER_URL=http://127.0.0.1:5174
# or
export CAP_SERVER_URL=http://127.0.0.1:5174
```

## Native integrations

Android:

- Push: Capacitor Push Notifications + FCM. Data-only messages are rendered by `LinkyFirebaseMessagingService`, so notifications show while the app is closed. Needs `android/app/google-services.json`.
- Encrypted secret storage for identity material (`LinkySecretStorageBridge`).
- Native QR scanning when WebKit camera APIs are unavailable.
- `nostr://`, `cashu://` and `nostrconnect://` URLs are forwarded to the web app: `nostr://npub...` opens or creates the contact, `cashu://cashu...` imports the token, `nostrconnect://...` is handed over whole as a Nostr Connect login request.
- NFC: reads NDEF URI and `text/plain` records with those schemes; writes `cashu://cashu...` from token detail and `nostr://npub...` from the profile.
- File export (data backup, chat images and PDFs) writes to the app cache and opens the share sheet.

iOS: Keychain-backed secret storage, native QR scanning and CoreNFC NDEF writing for the same payloads. Notifications and deep links are not wired on iOS yet.
