# Bluetooth device testing

The first implementation supports live public BitChat messages and authenticated nearby Linky discovery on Android and iOS. Keep each app in the foreground. The PWA has no Bluetooth setting or room.

## Install

- Android: `bun run native:apk:debug`. Install `apps/native-shell/android/app/build/outputs/apk/debug/app-debug.apk`. It appears as **Linky Dev**, beside your regular Linky installation.
- iPhone: `bun run native:ios:sync`, then `bun run native:ios:open`. Select the physical iPhone and your development signing team in Xcode, then Run. This does not create a TestFlight release.

Use a test Linky account. Wi-Fi/mobile data can be turned off after login; leave Bluetooth on.

## Part 1: settings and BitChat public room

1. Open Settings in Linky Dev. Bluetooth chat starts off. Grant permission when enabling it. On Android 6–11, BLE discovery also needs Location permission and the system Location switch.
2. Open BitChat's **Bluetooth mesh** room on the other phone. Use neither a geographic Nostr room nor a private chat. Keep both apps open and wait up to 30 seconds.
3. At the bottom of Linky's Contacts, open **Public Bluetooth chat**. Check that nearby peers appear and send `hello from Linky`. Confirm BitChat receives it under your normalized Linky name.
4. Reply from BitChat. Confirm the sender name and text appear in Linky once. Repeat with the roles swapped across Android and iPhone when a Linky iPhone build is installed.
5. Send a longer message from BitChat, including accented characters or emoji, to exercise incoming compression/fragmentation. Linky's outgoing field currently permits at most 99 UTF-8 bytes. Nicknames are normalized and shortened to 25 UTF-8 bytes.
6. Disable Linky's setting. Its room entry and nearby badges disappear, and the other phone should expire Linky's presence. Turn it on again and check reconnection.
7. Toggle system Bluetooth off/on, background/resume Linky, and revoke/regrant permission in system settings. Linky should report the inactive reason, clear stale presence, and reconnect when enabled and available.

## Part 2: nearby Linky contacts

This needs **Linky running on both phones**. BitChat alone does not implement Linky's Nostr identity proof.

1. Use different Linky accounts and enable Bluetooth chat on both. Repeat with BitChat still running in the background on each phone; Linky must discover the Linky identity service even when BitChat also exposes its public-chat service.
2. Open Add contact. The other account appears in **Nearby Linky users** with its Nostr profile name and avatar. Its public room nickname is not used as contact profile data. Your own account and already saved contacts do not appear. A cached profile or shortened public key remains usable when profile fetching is unavailable.
3. With internet disabled, add the other account. It should save, move to the top of Contacts, and show a **Nearby** badge.
4. Verify that existing contact names and group/search filters still behave normally.
5. Disable Bluetooth or background the other Linky app. The badge disappears and normal ordering returns. Allow up to 60 seconds for stale presence to expire after an abrupt radio loss.
6. Open the saved private chat. It remains the normal encrypted Nostr chat; proximity does not switch it to Bluetooth.

## Current limits and evidence

- Foreground only, no background message notifications or durable Bluetooth outbox.
- Live public text only; no BitChat private DMs, media, geographic rooms, or gossip history synchronization.
- “Sent” means queued to connected Bluetooth peers, not acknowledged by every person in the room.
- A nearby peer count estimates directly connected BitChat identities. A public mesh participant may be farther away through relays. The friend badge requires a fresh signed Linky proof on a direct connection.
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
