# Nostr Connect login

A website shows a `nostrconnect://` link or QR code (NIP-46) to let a user sign in with their Nostr key. `NostrConnect.login` answers it once as the remote signer for the configured identity: it acknowledges the link, shares the public key, signs the site's login event, then closes every subscription. There is no session and nothing is stored; a second login needs a fresh link.

## Calling it

1. Parse what the user scanned or opened with `parseNostrConnectUri(text)`. It returns a `NostrConnectRequest`, or `null` when the text is not a usable link: wrong scheme, no `relay` that is a valid `RelayUrl`, a client pubkey that is not on the curve, or no `secret`. Whitespace and scheme case are tolerated; duplicate relays are dropped and at most five are kept.
2. Show the user `name`, `url` and `image` before going on. The site supplies them itself and nothing verifies them.
3. Call `login(request)`, or `nostrConnectLoginAtom` in React. It resolves with a `NostrConnectLoginReceipt` once the site got what it asked for.

```ts
import { Effect } from "effect";
import { NostrConnect, parseNostrConnectUri } from "@linky-fit/linkstr";

declare const scanned: string;

const program = Effect.gen(function* () {
  const request = parseNostrConnectUri(scanned);
  if (request === null) return null;
  const connect = yield* NostrConnect;
  return yield* connect.login(request);
});
```

Interrupting `login` (the user cancels, the screen unmounts) closes its subscriptions. Relays come from the link only; the identity's own read and write relays are not used.

## What the site can get

| Request          | Answer                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| `get_public_key` | the identity pubkey (hex)                                                                           |
| `sign_event`     | the signed event as a JSON string, only when the policy below allows it; `created_at` is set to now |
| `connect`        | `ack`                                                                                               |
| `ping`           | `pong`                                                                                              |
| anything else    | `error: unsupported method <method>`; the login keeps waiting, so optional probes do not break it   |

`sign_event` signs the template's kind, tags and content unchanged when all three hold:

- the kind is 27235 (NIP-98 HTTP auth) or 22242 (NIP-42 relay auth);
- the link has no `perms`, or they contain `sign_event` or `sign_event:<kind>`;
- the link has no `url`, or every `u` tag of the template has the same host (case-insensitive).

Anything else is refused: the site gets an `error` reply with the reason and `login` fails with `NostrConnectRequestRefused`.

## When it ends

| Situation                                                  | Result                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------ |
| a `sign_event` was answered                                | receipt with `signedKind` set                                |
| the pubkey was shared, then no request for 10 s            | receipt with `signedKind: null`                              |
| no relay accepted the ack or a reply                       | `NostrConnectAckNotDelivered` with each relay's `results`    |
| no request subscription opened, or every one of them ended | `NostrConnectRelaysUnreachable` with each relay's `failures` |
| a `sign_event` was refused                                 | `NostrConnectRequestRefused` with `method` and `reason`      |
| none of the above within 60 s                              | `NostrConnectTimedOut`                                       |

Every error means the site is not logged in. Ask the user to refresh the link on the site and scan again; for `NostrConnectAckNotDelivered` and `NostrConnectRelaysUnreachable`, check the connection first, or ask the site for a link with other relays. A refusal is the site asking for more than a login, so do not retry it automatically.

## Wire format

Every message is a kind 24133 plain event signed by the identity, tagged `["p", <client pubkey>]`, with NIP-44 v2 content encrypted between the identity and the client pubkey. Requests from the site are the same shape in reverse; events that do not verify, do not decrypt with NIP-44 (NIP-04 is not supported) or repeat an id already answered are ignored.

1. Subscribe on the link's relays to `kinds: [24133]`, `authors: [client]`, `#p: [identity]`, `since: now - 60`, and wait until each relay reports end of stored events (at most 5 s). The events are ephemeral, so a relay only forwards them to subscriptions already open. If every subscription already ended, nothing is published. Subscriptions are never reopened: once the last one ends, the login fails at once instead of waiting for the timeout.
2. Publish the ack `{"id": <random>, "result": <secret>}` to the same relays.
3. Answer each request `{"id", "method", "params"}` with `{"id", "result"}` or `{"id", "error"}`.

24133 is also the payment-notice rumor kind ([payment-kinds.md](./payment-kinds.md#payment-notices)). They never collide: a payment notice only ever travels inside a kind 1059 gift wrap.

Inspector rows name the operation `nostrConnect.login`; its params omit the secret.
