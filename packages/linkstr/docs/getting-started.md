# Getting started

`@linky/linkstr` is Linky's Nostr protocol as a typed library: hand in a draft, get a receipt back, and consume everything inbound as one tagged union. Raw Nostr events never cross the package boundary. This page takes you from two keys to a delivered message and its inbox echo, in one file you run.

## Core concepts

- **Services per vertical.** Each protocol feature is an Effect service (`Chat`, `Reactions`, `Profiles`, `WrapInbox`, …): `yield* Chat`, then call a method.
- **Drafts in, receipts out, facts back.** A send takes a draft (`TextMessageDraft`, `ReactionDraft`, …) and returns a receipt. Inbound arrives as `WrapInboxEvent`, a union you switch on by `_tag`.
- **Gift-wrapped vs plain.** Private verticals (chat, reactions, receipts, notices, offers) travel encrypted inside kind-1059 gift wraps and are read through one `WrapInbox` subscription. Public verticals (profiles, relay lists, mute list) are plain signed events with their own fetch and watch calls.
- **Honest delivery.** A private send publishes one copy to you and one to the peer, and succeeds only when a relay accepted the peer's copy; otherwise you get `RecipientNotReached` or `NoRelayReachable`. The [outbox](./outbox.md) adds retries when you want a queue.
- **Branded types, typed errors.** Keys, pubkeys, relay urls, and ids are branded (`NostrSecretKey`, `Pubkey`, `RelayUrl`, `RumorId`) and built with exported codecs. Every failure is a tagged error you match on.

[concepts.md](./concepts.md) defines the vocabulary (rumor, gift wrap, own echo, EOSE) and goes deeper on each point.

## Import paths

| Path                     | What you get                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| `@linky/linkstr`         | services, drafts, receipts, facts, key codecs, `runLinkstr`, `linkstrServices`                     |
| `@linky/linkstr/testing` | `makeIdentity`, publish stubs, `FakeRelay`, `stubStorage`; tests only ([testing.md](./testing.md)) |
| `@linky/linkstr-react`   | effect-atom bindings for the web app ([react.md](./react.md))                                      |

Never import `nostr-tools` in consumer code; the codecs in [identity-and-keys.md](./identity-and-keys.md) cover keys and ids.

## What you bring

1. Your `NostrSecretKey`: `decodeNsec("nsec1…")`.
2. The peer's `Pubkey`: `parsePubkey(str)` accepts `npub1…` or 64-hex.
3. `RelayUrl`s: `Schema.is(RelayUrl)` narrows a string; `RelayUrl.make(str)` throws on a bad one.

The two decoders return `null` on bad input instead of throwing. Check for it before you build a config; the script below stops on the first bad input.

## First run

You need two keys: yours and the peer's. Mint throwaway ones from the package directory. The testing helper is fine in a script you delete afterwards; never import it from app code.

```bash
cd packages/linkstr
bun -e 'import { makeIdentity } from "@linky/linkstr/testing"; import { encodeNpub, encodeNsec } from "@linky/linkstr"; const id = makeIdentity(); console.log(encodeNsec(id.secretKey), encodeNpub(id.pubkey));'
```

Run it twice. Keep the first `nsec` as `NSEC` and the second `npub` as `PEER`. Save this as `packages/linkstr/firstRun.ts` (workspace imports resolve there):

```ts
import { Effect, Option, Schema, Stream } from "effect";
import {
  Chat,
  decodeNsec,
  MessageText,
  parsePubkey,
  RelayUrl,
  runLinkstr,
  TextMessageDraft,
  UnixSeconds,
  WrapInbox,
  type WrapInboxEvent,
} from "@linky/linkstr";

const input = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`set ${name}`);
  return value;
};

const secretKey = decodeNsec(input("NSEC"));
const peer = parsePubkey(input("PEER"));
const relay = input("RELAY");
if (secretKey === null) throw new Error("NSEC is not a valid nsec");
if (peer === null) throw new Error("PEER is not an npub or a hex pubkey");
if (!Schema.is(RelayUrl)(relay)) throw new Error("RELAY is not a ws(s):// url");

const config = { secretKey, readRelays: [relay], writeRelays: [relay] };

const sendHello = () =>
  runLinkstr(
    config,
    Effect.gen(function* () {
      const chat = yield* Chat;
      const receipt = yield* chat.sendText(
        new TextMessageDraft({
          to: peer,
          content: MessageText.make("hello from linkstr"),
        }),
      );
      return `sent ${receipt.rumorId}: peer copy accepted by ${receipt.recipientCopy.acceptedBy.length} relay(s)`;
    }).pipe(
      Effect.catchTags({
        RecipientNotReached: (error) =>
          Effect.succeed(
            `peer copy rejected by ${error.recipientCopy.rejectedBy.length} relay(s); nothing to retry automatically`,
          ),
        NoRelayReachable: () =>
          Effect.succeed("no relay accepted anything; is RELAY up?"),
      }),
    ),
  );

const label = (event: WrapInboxEvent): string =>
  event._tag === "OwnChatMessageConfirmed"
    ? `${event._tag} ${event.messageId}`
    : event._tag;

const printFirstInboxEvent = () =>
  runLinkstr(
    config,
    Effect.scoped(
      Effect.gen(function* () {
        const inbox = yield* WrapInbox;
        const feed = yield* inbox.open({
          since: UnixSeconds.make(Math.floor(Date.now() / 1000) - 60),
        });
        const first = yield* Stream.runHead(feed.events);
        return Option.map(
          first,
          ({ delivery, event }) => `${delivery} ${label(event)}`,
        );
      }),
    ).pipe(
      Effect.timeoutOption("20 seconds"),
      Effect.map((result) =>
        Option.getOrElse(
          Option.flatten(result),
          () => "nothing arrived in 20 s",
        ),
      ),
    ),
  );

console.log(await sendHello());
console.log(await printFirstInboxEvent());
```

Start the local relay from the repo root and run the file:

```bash
docker compose -f docker-compose.dev.yml up -d --wait nostr-relay
NSEC=nsec1… PEER=npub1… RELAY=ws://localhost:7777 bun run packages/linkstr/firstRun.ts
```

Expected output (ids shortened here; yours are 64 hex chars and match on both lines):

```
sent 9049fbe8…: peer copy accepted by 1 relay(s)
backfill OwnChatMessageConfirmed 9049fbe8…
```

What happened:

- `runLinkstr` built every service over the key and relays, ran the effect, and closed the relay pool. Two calls, two pools.
- `Chat.sendText` wrapped the message twice, once to the peer and once to you, and the receipt reports both copies. `catchTags` turns the two delivery failures into strings; any other failure rejects the promise.
- `WrapInbox.open` subscribed to kind 1059 for your pubkey. A `Scope` owns the subscription; leaving `Effect.scoped` closes it. The first event is your own copy coming back, an **own echo** tagged `OwnChatMessageConfirmed`, with the same rumor id the receipt gave you. `backfill` means the relay served it from storage, before its EOSE marker. See [inbox.md](./inbox.md).

Point `RELAY` at a closed port and the lines become `no relay accepted anything; is RELAY up?` and `nothing arrived in 20 s`. A bad `NSEC` stops before any network call: `error: NSEC is not a valid nsec`.

Delete `firstRun.ts` when you are done; it is not part of the package.

## Two ways to run

Both take `secretKey`, `readRelays`, and `writeRelays` (arrays of `RelayUrl`).

- **`runLinkstr(config, effect)`**: one-shot, as above. Builds the services, runs the effect, tears down the pool. Use it in the service worker, scripts, and tests. `writeRelays` defaults to `[]` for read-only consumers; optional `outboxStore` and `transport` (test seam). The inbox cursor is in memory.
- **`linkstrServices(config)`**: the same composition as a `Layer`, for a runtime that outlives one call. `writeRelays` and `transport` (normally `NostrTransportSimplePool`) are required; `outboxStore` and `inboxCursorStore` are optional and default to memory. In React do not use it by hand: `@linky/linkstr-react` builds this layer from `linkstrConfigAtom` and rebuilds it on identity change ([react.md](./react.md)).

## Next

Pick the guide for the vertical you need from the [guide index](./README.md). Each opens with a working example and ends with its error table.

## Related

- [concepts.md](./concepts.md) — vocabulary, the mental model, and a minimal Effect primer
- [react.md](./react.md) — the atoms you use inside the web app
- [testing.md](./testing.md) — stubs and fakes for unit tests
- [../README.md](../README.md) — design rules and their rationale
