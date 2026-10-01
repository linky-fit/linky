# Getting started

From two keys to a delivered message and its inbox echo, plus the two ways to run the package.

## Install

```bash
bun add @linky-fit/linkstr effect
```

| Import path                        | What you get                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| `@linky-fit/linkstr`               | services, drafts, receipts, facts, key codecs, `runLinkstr`, `linkstrServices`                   |
| `@linky-fit/linkstr/testing`       | test helpers ([testing.md](./testing.md)); needs Vitest 4, the main entry does not               |
| `@linky-fit/linkstr-react`         | Effect atom bindings for React ([react.md](./react.md)); a private workspace package, not on npm |
| `@linky-fit/linkstr-react/testing` | its test helpers                                                                                 |

Never import `nostr-tools` in consumer code; the codecs in [identity-and-keys.md](./identity-and-keys.md) cover keys and ids.

## What you bring

1. Your `NostrSecretKey`: `decodeNsec("nsec1…")`.
2. The peer's `Pubkey`: `parsePubkey(str)` accepts `npub1…` or 64-hex.
3. `RelayUrl`s: `Schema.is(RelayUrl)` narrows a string; `RelayUrl.make(str)` throws on a bad one. `wss://` only, except loopback `ws://` for local development ([concepts.md](./concepts.md#branded-primitives)).

Both decoders return `null` on bad input instead of throwing; check before building a config.

## Two ways to run

Both take `secretKey`, `readRelays` and `writeRelays` (arrays of `RelayUrl`) and both accept optional `outboxStore` and `inboxCursorStore` layers (default: in-memory, so nothing survives a restart) and a `transport` layer (a test seam).

**`runLinkstr(config, effect)`** is the one-shot Promise runner: it builds every service over the config, runs the effect, and closes the relay pool. Use it in scripts, service workers and tests. Two calls mean two pools. `writeRelays` defaults to `[]` for read-only consumers; `allowInsecureLocalhost: true` lets the default transport open loopback `ws://` relays.

**`linkstrServices(config)`** is the same composition as a `Layer`, for a runtime that outlives one call (a long-running process, a React app). `writeRelays` and `transport` are required; the usual transport is `NostrTransportSimplePool`, or `makeNostrTransportSimplePool({ allowInsecureLocalhost: true })` for a local relay. Decorate the transport first when you want observability ([diagnostics.md](./diagnostics.md)):

```ts
import { Effect, ManagedRuntime } from "effect";
import {
  Chat,
  linkstrServices,
  NostrTransportSimplePool,
  type NostrSecretKey,
  type RelayUrl,
} from "@linky-fit/linkstr";

export const makeRuntime = (
  secretKey: NostrSecretKey,
  relays: ReadonlyArray<RelayUrl>,
) =>
  ManagedRuntime.make(
    linkstrServices({
      secretKey,
      readRelays: relays,
      writeRelays: relays,
      transport: NostrTransportSimplePool,
    }),
  );

// runtime.runPromise(Effect.flatMap(Chat, (chat) => chat.sendText(draft)))
// runtime.dispose() closes the pool and every subscription.
```

In React neither is called by hand: `@linky-fit/linkstr-react` builds the layer from `linkstrConfigAtom` and rebuilds it on every config change ([react.md](./react.md)).

## First run

Generate two throwaway keys:

```bash
bun -e 'import { NostrSecretKey, derivePubkey, encodeNpub, encodeNsec } from "@linky-fit/linkstr"; const secretKey = NostrSecretKey.make(crypto.getRandomValues(new Uint8Array(32))); console.log(encodeNsec(secretKey), encodeNpub(derivePubkey(secretKey)));'
```

Run it twice; keep the first `nsec` as `NSEC` and the second `npub` as `PEER`. Save this as `firstRun.ts`:

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
} from "@linky-fit/linkstr";

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

const config = {
  secretKey,
  readRelays: [relay],
  writeRelays: [relay],
  allowInsecureLocalhost: true,
};

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
            `peer copy rejected by ${error.recipientCopy.rejectedBy.length} relay(s)`,
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

```bash
NSEC=nsec1… PEER=npub1… RELAY=wss://relay.example bun run firstRun.ts
```

Expected output (ids shortened; yours are 64 hex chars and match on both lines):

```
sent 9049fbe8…: peer copy accepted by 1 relay(s)
backfill OwnChatMessageConfirmed 9049fbe8…
```

`Chat.sendText` wrapped the message twice, to the peer and to you, and the receipt reports both copies; `catchTags` turns the two delivery failures into strings, anything else rejects the promise. `WrapInbox.open` subscribed to kind 1059 for your pubkey inside a `Scope`; leaving `Effect.scoped` closes it. The first event is your own copy coming back, the own echo `OwnChatMessageConfirmed`, with the rumor id the receipt gave you. `backfill` means the relay served it from storage ([inbox.md](./inbox.md)).

Point `RELAY` at a closed port and the lines become `no relay accepted anything; is RELAY up?` and `nothing arrived in 20 s`. A bad `NSEC` stops before any network call. `allowInsecureLocalhost` is only needed for a `ws://localhost` relay; leave it unset in production.
