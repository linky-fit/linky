# Bluetooth device testing

The implementation supports authenticated nearby Linky discovery on Android and iOS. The experimental public BitChat room entry is hidden pending UX review. Keep each app in the foreground. The PWA has no Bluetooth setting or room.

## Install

- Android: `bun run native:apk:debug`. Install `apps/native-shell/android/app/build/outputs/apk/debug/app-debug.apk`. It appears as **Linky Dev**, beside your regular Linky installation.
- iPhone: `bun run native:ios:sync`, then `bun run native:ios:open`. Select the physical iPhone and your development signing team in Xcode, then Run. This does not create a TestFlight release.

Use a test Linky account. Wi-Fi/mobile data can be turned off after login; leave Bluetooth on.

## Part 1: settings and nearby contacts

This needs **Linky running on both phones**. BitChat alone does not implement Linky's Nostr identity proof.

1. Use different Linky accounts. Open Settings and enable Bluetooth chat on both phones. Grant permission when prompted. On Android 6–11, discovery also needs Location permission and the system Location switch.
2. Keep both apps open and wait up to 30 seconds. Repeat with BitChat still running in the background on each phone; Linky must select its identity-capable service even when BitChat exposes a public-chat service too.
3. Saved nearby friends appear in a **Nearby** section below any recently added contacts and active proxy-payment contacts. Priority contacts stay in their original position even when nearby, and appear only once. Their cards have no Nearby badge. There is no public Bluetooth chat button.
4. Verify that existing contact names and group/search filters still behave normally.
5. Disable Bluetooth or background the other Linky app. The Nearby section disappears and normal ordering returns. Allow up to 60 seconds for stale presence to expire after abrupt radio loss.
6. Toggle system Bluetooth off/on, background/resume Linky, and revoke/regrant permission in system settings. Linky should report the inactive reason, clear stale presence, and reconnect when enabled and available.

## Part 2: nearby suggestions

1. Open Add contact without typing. Nearby unsaved users appear first in the existing suggestions list, followed by the usual suggestions. There is no separate nearby suggestions section.
2. Check Nostr profile names and avatars. The public-room nickname is not used as contact profile data. Your own account and already saved nearby contacts do not appear; a person who is also in the usual suggestions appears only once.
3. Start typing. The suggestion list disappears and normal search takes over. Clear the input to restore suggestions with nearby users first.
4. With internet disabled, a cached profile or shortened public key remains usable. Add the nearby account; it should save and appear in the Nearby section of Contacts.
5. Open its private chat. It remains the normal encrypted Nostr chat; proximity does not switch it to Bluetooth.

## Current limits and evidence

- Foreground only, no background message notifications or durable Bluetooth outbox.
- Live public text only; no BitChat private DMs, media, geographic rooms, or gossip history synchronization.
- “Sent” means queued to connected Bluetooth peers, not acknowledged by every person in the room.
- A nearby peer count estimates directly connected BitChat identities. A public mesh participant may be farther away through relays. The Nearby section requires a fresh signed Linky proof on a direct connection.
- BitChat Swift sources are Unlicense. The implementation does not incorporate GPL Android source. Protocol fixtures identify the Swift source commit and generator; tests validate real Swift-generated signatures and fragments. This does not substitute for radio tests against the installed releases.

For a failure, note the device/OS, BitChat version, direction of the failed message, and whether each app was foregrounded. In Linky, enable Inspector logs before reproducing, then download them from Settings → Inspector. Bluetooth rows contain state changes, direct links, public messages, and frame sizes, never private keys. For missing nearby contacts, inspect `bluetooth.peerChanged` for `identity: true`, then follow the link through `bluetooth.identityRequested` to `bluetooth.identityVerified` or `bluetooth.identityIgnored`. Ignored proofs record whether the challenge was stale, the proof was invalid, or the peer uses your own account.

## Repeat protocol verification

On macOS with Bun and Swift installed, check out `permissionlesstech/bitchat` at `9b84b361225facd8e623f25d76f889d3dc54a879`, then run:

```bash
bash apps/web-app/scripts/verify-bitchat.sh /path/to/bitchat
```

The script uses the actual upstream BitFoundation package to generate inbound fixtures and verify four packets from Linky's running mesh engine with CryptoKit. It checks the upstream revision and uses a temporary build directory. Fixture key seeds are public test values.

## Repeat service-selection regression tests

These tests cover Linky and BitChat exposing the same service UUID on one phone, in either discovery order. Android uses real GATT service objects on a connected emulator or test device:

```bash
cd apps/native-shell/android
bash ../scripts/with-java17.sh ./gradlew :app:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=fit.linky.app.LinkyBluetoothServiceSelectionTest
```

The iOS selection test uses real CoreBluetooth service objects on macOS, from the repo root:

```bash
xcrun swiftc apps/native-shell/ios/App/App/LinkyBluetoothService.swift apps/native-shell/ios/tests/BluetoothServiceSelectionTests.swift -o /tmp/linky-bluetooth-service-tests
/tmp/linky-bluetooth-service-tests
```
