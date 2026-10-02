# NFC bolt card

Paying a bolt card POS from the Linky wallet: the Android app emulates an NTAG 424 DNA bolt card over NFC, and the card bridge (`apps/bolt-card-bridge`) hosts the LNURL-withdraw endpoint the POS calls. Background on card simulation: https://gist.github.com/pepakriz/048b0c44dad24bee802e6c1b7d1ba3d5#simulace-bolt-karty

## Decisions

- Funds come from the user's Cashu balance; the phone melts at the mint itself. The bridge only relays LNURL-withdraw traffic and never holds funds.
- The bridge talks to the phone over a WebSocket the phone opens for the session, not over Nostr: both sides are online at tap time, so relay store-and-forward only adds latency and a dependency.
- A card is device-local: its keys, UID and counter never sync, so two devices cannot race the counter. A lost device means a new card on the next device, nothing to revoke server-side.
- The POS sets the amount. Invoices up to the auto-pay limit are paid without asking, larger ones ask on the phone, exactly as for a scanned invoice. There is no separate per-card limit.
- `maxWithdrawable` is the spendable balance minus the estimated melt fee reserve (1 %, at least 2 sat), so the POS does not issue an invoice the wallet cannot pay.
- Only the NFC tap is in scope. Handing card keys to a merchant for recurring payments (`boltcard:request` in the gist) is a separate feature.
- The Send screen arms the card itself once the user turned on **Advanced → NFC bolt card → Switch on with the Send screen**. The switch is the synced setting `boltCard.armOnSend` in `@linky-fit/linksync`; unset means off. It syncs to every device while each Android device keeps its own card, so turning it on arms Send on all the user's Android phones.
- Android Capacitor only. iOS has no general HCE and the web has no card emulation; the card stays off and the settings entry is hidden there.

## Flow

```
POS ──NFC──▶ Phone (HCE)                      serves lnurlw URL with fresh p/c, counter++
POS ──HTTPS─▶ Bridge GET /w/<cardId>?p&c ─WS─▶ Phone: verify p/c, reply k1 + min/max
POS ──HTTPS─▶ Bridge GET /cb/<cardId>?k1&pr ─WS─▶ Phone: check k1, ack → Bridge answers POS "OK"
                                               Phone: auto-pay limit / confirm → melt at mint
```

1. With the switch on, opening Send starts a session: the app loads the card, starts the bridge WebSocket and, at the same time, arms HCE with the first URL; the card is readable without waiting for the network. The socket signs the bridge's challenge with the card key. The camera keeps scanning QR codes meanwhile.
2. The POS reads the NDEF file. The native service reports the read, the app persists counter + 1 and sets the next URL, so every read yields a fresh one.
3. The POS turns `lnurlw://` into `https://` and calls the bridge, which forwards the request to the phone. The phone answers only a `p` it issued in this session, checks `c`, and answers a LUD-03 `withdrawRequest` with a random `k1`, `minWithdrawable` 1 sat and the `maxWithdrawable` above. A repeated request for the same read gets the same offer; any other reuse is rejected.
4. The POS sends its invoice to the callback. The phone checks `k1`, requires a fixed-amount, unexpired invoice within `maxWithdrawable`, and acks at once; the bridge answers the POS `{"status":"OK"}`. LUD-03 lets the service pay after answering, and the POS waits for settlement.
5. The phone hands the invoice to the scanned-invoice path: auto-pay up to the limit, confirmation above it, `Melt` from linkshu. If the user declines, the invoice expires and the POS reports failure.
6. The session lasts as long as Send is open. It ends when Send closes (an accepted invoice closes it too), when the app pauses, or on any failure; the Send screen then offers to switch the card on again. A POS that reads the card before the phone's socket is ready waits at the bridge (up to 3 s). A dropped socket is reconnected up to 3 times; the card switches off when the bridge stays away for 10 s or refuses the card.

## SUN parameters

The phone generates the URL and verifies it again when the bridge forwards it, so K1 and K2 never leave the device. `p`/`c` still matter: some POS check the bolt card URL shape, and the URL looks exactly like a physical card's.

- UID: 7 bytes per card, `04` followed by 6 random bytes like an NXP UID. Counter: 3 bytes, **little-endian** (the gist's `'000001'` matches only for 1).
- `p` = AES-128-CBC, zero IV, no padding, key K1, over `C7 ‖ UID ‖ counter ‖ 5 random bytes` (one 16-byte block).
- `c` = odd bytes (indexes 1, 3, …, 15) of `CMAC(CMAC(K2, 3CC300010080 ‖ UID ‖ counter), empty)`.
- `@noble/ciphers` provides unpadded CBC and CMAC; `packages/bolt-card` checks them against the boltcard specification test vectors.
- The counter is written before the URL is handed to HCE, so a crash can skip a value but never reuse one. Taps are also matched by their exact `p`, so a URL from an earlier session never verifies.

## Components

### `packages/bolt-card`

Pure TypeScript without I/O, shared by the app and the bridge: card creation and storage format, `issueBoltCardTap`, SUN verification, and the WebSocket messages as effect `Schema`s with the challenge signature. The protocol is not Nostr, so it stays out of `linkstr`. Its README lists the calls.

### Card state

Created on first activation and kept in the encrypted native store (`LinkySecretStorageBridge`, key `linky.bolt_card.v1`), never in Evolu: K1, K2, UID, the secp256k1 card key and the counter. Keys are random, not derived from the recovery seed, because a card belongs to one device. **Advanced → NFC bolt card** shows the card and replaces it; a replaced card's URLs stop verifying.

### Android HCE (`apps/native-shell/android`)

- `LinkyBoltCardHceService` emulates a read-only NFC Forum Type 4 Tag: AID `D2760000850101`, capability container `E103`, NDEF file `E104` holding one URI record with the full URL. It answers `SELECT` and `READ BINARY`, refuses `UPDATE BINARY`, and answers "not found" while no URL is set. A URL swapped mid-read never mixes into the current read.
- `res/xml/bolt_card_apdu_service.xml` registers the AID in category `other` with `requireDeviceUnlock`.
- The service component is enabled in `onResume` and disabled in `onPause`, so its registration and the AID routing update it triggers (up to a second) happen long before a session; outside a session it answers "not found". `MainActivity` asks `CardEmulation.setPreferredService` in `onResume` (again after 750 ms, once the enabled component is registered).
- `started` is reported once `CardEmulation.isDefaultServiceForAid` confirms Android routes the AID to Linky, or after 3 s with the message `unconfirmed`, which the inspector records.
- Reader mode disables card emulation, so starting a session cancels a pending tag write.
- `onPause` stops the session: the card is never readable while Linky is not in front.
- JS bridge `LinkyNativeBoltCard`: `isSupported()`, `start(url)`, `setUrl(url)`, `stop()`; events `linky-native-bolt-card` with `started`, `read` (NDEF file read to its end), `deselected`, `stopped`, `disabled`, `unsupported`, `error`.
- HCE speaks only ISO-DEP. A POS that sends native NTAG commands (GET_VERSION, 424 DNA authentication) will not see the card. NDEF-only readers such as LNbits TPoS, BTCPay and Bolt Card POS should work; that needs testing on real terminals.

### Bridge (`apps/bolt-card-bridge`)

Bun service following the `apps/push` setup; its README covers endpoints, environment and deployment.

- `WS /session`: the phone proves ownership of `cardId` (its card public key) by signing a server challenge. One live session per card; a newer one replaces it.
- `GET /w/:cardId` and `GET /cb/:cardId` forward the query to the session and return the phone's answer. A request for a card without a session waits up to 3 s for it to connect, capped per card and in total. With no session after that, or no answer within 5 s, they return `{"status":"ERROR","reason":"Card is not active"}`.
- Stateless apart from live sockets. Rate-limited per card and IP. Logs carry no invoices, card ids or client IPs.
- The bridge URL is a user setting (**Advanced → NFC bolt card**); `VITE_BOLT_CARD_BRIDGE_URL` only sets the default, `https://bolt-card.linky.fit` without it.

The bridge sees invoices and could submit its own up to the auto-pay limit. That is the trust placed in it, bounded by the session window, the single-use taps, and confirmation above the limit. Quote ids and proofs still go only from the phone to the mint, and nothing from the recovery seed leaves the device.

### Web app

- `useBoltCardSession` runs one session: phases `idle → connecting → ready → paying`, or `ended` (Send closed or app paused) and `failed` (unsupported, NFC off, bridge, storage, exhausted counter, native error). `ready` means NFC is armed; the bridge may still be connecting.
- `BoltCardTapSession` holds the card's answers to the bridge: issued taps, the single offer, the single invoice.
- `BoltCardSendStatus` is the status row of the Send screen (`ScanModal`). It renders only when `boltCard.armOnSend` is on and the device can emulate a card, runs the session while mounted, and shows the limit, the phase or the failure with a retry. The accepted invoice takes the scanned-invoice path, which closes Send and pays or asks for confirmation.
- `useBoltCardArmOnSend` reads and writes the synced switch; **Advanced → NFC bolt card** holds it together with what turning it on means: any nearby reader can charge up to the auto-pay limit while Send is open, Android with NFC and internet only, synced to all devices.
- Copy in cs, en and de.
- Inspector channel `boltcard`: `boltCard.sessionStarted` (with the card load time), `boltCard.nfcStarted` and `boltCard.bridgeReady` (with the time since start, to see which step delays activation), `boltCard.bridgeLost`, `boltCard.tagRead`, `boltCard.withdrawAnswered`, `boltCard.invoiceAnswered`, `boltCard.sessionEnded`, linked by `boltCardSession` and `boltCard`. Rows carry counters, amounts and reasons, never keys, `p`/`c` or invoices.

## Security measures

- Emulation runs only after the user turned the switch on (off by default), only while Send is open, the app is in the foreground and the device is unlocked. The settings page states that any nearby reader can then charge up to the auto-pay limit.
- Each tap is answered only if issued in the current session, and only once; the session ends after one accepted invoice.
- The amount cap is the spendable balance minus fee reserve, and the auto-pay limit decides when the user is asked.

The terms bolt card, card tap and card bridge are defined in `GLOSSARY.md`.

## Testing

- `packages/bolt-card`: boltcard specification vectors, tap round trips, storage format, challenge signatures, message schemas.
- `apps/bolt-card-bridge`: sessions with fake sockets (auth, replacement, timeouts, pending requests on close) and the LNURL endpoints end to end.
- Web app: `BoltCardTapSession` (replays, foreign taps, limits, expired and amountless invoices) and `useBoltCardSession` against a fake bridge socket and native bridge.
- Manual, still open: Linky on one Android phone with a POS app (LNbits TPoS, Bolt Card POS) on another, then physical BTCPay/LNbits terminals.
