# Device pairing

`DevicePairing` moves an account's recovery seed to a new device without showing it: the device that has it shows a QR code, the new device scans it and shows six digits, the user types them into the first device, and only then does the seed travel, encrypted between two throwaway keys. It speaks Finito's `payky:pair` protocol byte for byte, so Linky, Fazole and Finito add each other's devices.

Neither side needs an identity: `DevicePairing.layer` takes a `NostrTransport` and nothing else, so a device that has no account yet can join.

```ts
import { Effect, Layer, ManagedRuntime } from "effect";
import { DevicePairing, NostrTransportSimplePool } from "@linky-fit/linkstr";

// Keep the runtime for the app's life: it owns the relay pool.
const runtime = ManagedRuntime.make(
  DevicePairing.layer.pipe(Layer.provide(NostrTransportSimplePool)),
);
const pairing = await runtime.runPromise(
  Effect.gen(function* () {
    return yield* DevicePairing;
  }),
);
```

## Offering the seed

`offer({ payload, relays, onState })` starts a session on the first two `relays` and reports every change to `onState`:

| Phase     | What to show                                                                                                           |
| --------- | ---------------------------------------------------------------------------------------------------------------------- |
| `waiting` | `invite` as a QR code until `expiresAt` (two minutes)                                                                  |
| `locked`  | a field for the six digits; `mismatch` after a wrong code, `attemptsLeft` of three; `invite` turns `null` once expired |
| `sending` | progress                                                                                                               |
| `done`    | the device was added; `acked` says whether it confirmed, `deviceId` is the id it sent, if any                          |
| `expired` | nobody answered the invite; offer a new one                                                                            |
| `failed`  | `reason`: `cancelled`, `conflict` (a second device answered), `codeMismatch`, `timeout` or `network`                   |

Pass what the user types to `submitCode`; spaces are ignored. `cancel` ends the session and tells a locked device. The `payload` is the 16-byte master secret behind the recovery seed as hex, the account's name, and at most eight sync server URLs. It is a secret: keep it, the invite and the session out of logs.

Do not offer _Copy_ for the invite, and tell the user never to read their code to anyone: whoever types the right code in time gets the seed.

## Joining

`parsePairingInvite(text)` reads a scanned `payky:pair?v=1&…` text, or returns `null` for anything else, a newer version included. `join({ invite, deviceId, onState })` answers it:

| Phase        | What to show                                                                         |
| ------------ | ------------------------------------------------------------------------------------ |
| `connecting` | progress                                                                             |
| `code`       | `code`, formatted with `formatPairingCode`, to be typed into the offering device     |
| `received`   | `payload`, each transport once; restore the account from it, or let the user decline |
| `failed`     | `reason`: one of the offering side's, or `invalid` when the payload does not decode  |

The session waits five minutes for the payload. `cancel` ends it and tells the offering device.

## What it guarantees

- A relay that never saw the invite cannot answer it: the `hello` carries an HMAC keyed with the invite's session secret.
- The joining device shows its code only after a `ready` signed by the invite's key and addressed to it, so a relay that saw the invite cannot make it show a code for a session locked onto someone else.
- The offering device locks onto the first valid `hello`; a second one before the code is confirmed aborts both sides with `conflict`. Three wrong codes abort with `codeMismatch`.
- The payload travels only after the right code, NIP-44 encrypted between the two ephemeral keys, which are zeroed when the session ends.

## Wire format

Every message is a kind 28581 plain event signed by the sender's ephemeral key, tagged `["p", <recipient>]` and `["expiration", <now + 180>]`, with NIP-44 v2 JSON content. Both sides subscribe to `kinds: [28581]`, `#p: [<own ephemeral pubkey>]` without `since`.

| Message                                 | From     | When                                              |
| --------------------------------------- | -------- | ------------------------------------------------- |
| `{"t":"hello","proof","deviceId"?}`     | joining  | after scanning; `proof` is `pairingHelloProof`    |
| `{"t":"ready"}`                         | offering | after locking onto the hello                      |
| `{"t":"payload","data":PairingPayload}` | offering | after the right code                              |
| `{"t":"ack"}`                           | joining  | after a valid payload                             |
| `{"t":"abort","reason"}`                | either   | on cancel, conflict, three wrong codes or timeout |

The invite is `payky:pair?v=1&pk=<hex pubkey>&s=<16-byte hex secret>&r=<relay>[&r=<relay>]`. The code is the first four bytes of `HMAC-SHA256(s, "payky:pair:code:v1" ‖ source pubkey ‖ target pubkey)` modulo one million, zero-padded to six digits; the proof is the hex `HMAC-SHA256(s, "payky:pair:hello:v1" ‖ source pubkey ‖ target pubkey)`.
