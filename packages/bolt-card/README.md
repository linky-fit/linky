# @linky-fit/bolt-card

The emulated bolt card shared by the web app and `apps/bolt-card-bridge`: card keys, the SUN parameters a POS reads, and the WebSocket protocol between the card bridge and the device. Design and flow: [`docs/bolt-card.md`](../../docs/bolt-card.md).

## Design rules

- No React, Evolu, browser storage or I/O. The app stores the serialized card and runs NFC and the socket; the bridge only uses the protocol half.
- A card belongs to one device. Persist the card returned by `issueBoltCardTap` before serving its URL, so a counter is never handed out twice.
- `p`/`c` follow the boltcard specification bit for bit (counter least significant byte first), checked against its test vectors.
- The card key signs only the domain-separated bridge challenge.

## Use

- `createBoltCard()` once per device, `serializeBoltCard` / `parseBoltCard` for storage; a `null` parse means start a new card.
- `issueBoltCardTap(card, bridgeUrl)` for every NFC read: it returns the next card state, the URL for the NDEF record and its `p`, or `null` once the 3-byte counter is exhausted.
- `verifySun(card, card.uid, p, c)` when the bridge forwards a `withdraw`.
- The card answers bridge messages (`decodeBridgeMessage`) with `encodeCardMessage`: `auth` after the `challenge` (`signBridgeChallenge`), then `offer`, `accepted` or `rejected` with the request `id`.
