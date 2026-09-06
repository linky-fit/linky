# Concepts

The mental model behind every linkstr API: the words, what goes in, what comes out, how delivery is judged, and the little Effect you need to call it. Read it once before the vertical guides; come back when a type in a signature surprises you.

## Vocabulary

| Term                      | Meaning                                                                                                                                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rumor                     | The inner, unsigned Nostr event that carries the content (a message, a reaction). Its id, `RumorId`, is the stable identity of the thing sent.                                                              |
| Gift wrap                 | The encrypted, signed envelope (kind 1059) a rumor travels in, so relays see only ciphertext and a recipient tag. A fresh wrap is generated on every publish, so `WrapId` is transport-level identity only. |
| Self copy, recipient copy | A private send wraps the same rumor twice: once addressed to you, once to the peer.                                                                                                                         |
| Own echo                  | Your self copy coming back from a relay, or a send from another of your devices, surfaced as an `Own…Confirmed` fact. It is your reconciliation signal, never an incoming message.                          |
| EOSE                      | "End of stored events": the marker a relay sends once it has replayed everything it stored for your subscription. Events before it are `backfill`, events after it `live`.                                  |
| Plain event               | A signed Nostr event published as-is (profile, relay lists, mute list). Anyone can read it.                                                                                                                 |

## Drafts in, receipts out, facts back

Two-copy private verticals (chat, reactions, bank offers, seen receipts) have three shapes:

| Shape   | Direction   | Example                                 | Where                  |
| ------- | ----------- | --------------------------------------- | ---------------------- |
| Draft   | you → wire  | `ReactionDraft`, `TextMessageDraft`     | `<vertical>/domain.ts` |
| Receipt | wire → you  | `ReactionReceipt`, `ChatMessageReceipt` | `<vertical>/domain.ts` |
| Fact    | relay → you | `ReactionAdded`, `ChatMessageReceived`  | `<vertical>/events.ts` |

Drafts are `Schema.Class`es; build them with `new TextMessageDraft({ … })`. Optional `clientId` and `sentAt` are filled in when omitted; pass `clientId` when you already inserted an optimistic local row so the relay echo can be matched back.

Receipts are `Schema.TaggedClass`es. Every wrap receipt names the delivered rumor as `rumorId`, so you never switch on receipt class to find the id.

Facts arrive through `WrapInbox` as one tagged union, `WrapInboxEvent`. A two-copy vertical contributes a peer-authored fact and an own echo (`ReactionAdded` vs `OwnReactionConfirmed`, `ChatMessageReceived` vs `OwnChatMessageConfirmed`, …). Dispatch on `_tag`; see [inbox.md](./inbox.md).

The other verticals bend this shape: [payment notices](./payment-notices.md) are single-copy, so they have a peer fact but no own echo; [payment telemetry](./payment-telemetry.md) is single-copy and has no inbox fact at all; the plain verticals ([profiles](./profiles.md), [relay lists](./relay-lists.md), [mute list](./mute-list.md)) are fetched or watched rather than received through the inbox.

## Gift-wrapped vs plain

| Family          | On the wire                         | Verticals                                                                                                 |
| --------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Gift-wrapped    | kind 1059 around a rumor            | chat 14/15, reactions 7/5, payment notices 24133, telemetry 24134, bank offers 24135, seen receipts 24136 |
| Plain           | signed event, published as-is       | profiles 0 and 30315, relay lists 10002 and 10050, mute list 10000                                        |
| Never published | signed event used as an HTTP header | `httpAuth`: Blossom 24242, NIP-98 and push ownership proof 27235                                          |

`WrapInbox` receives and authenticates the gift-wrapped verticals (seal signature, rumor author equals seal author, rumor id equals rumor hash), except telemetry: it has no inbox decoder, so a telemetry wrap addressed to you surfaces as `WrapDropped("unsupported-kind")`. Plain verticals are fetched or watched (`ProfileWatch`) and verified by their own signature.

## Honest delivery

A private send wraps the same rumor twice: once to yourself (cross-device echo) and once to the peer. The receipt carries both as `selfCopy` and `recipientCopy` (`WrapDelivery`: `wrapId`, `acceptedBy`, `rejectedBy`, `accepted`).

| Outcome                                     | Result                 |
| ------------------------------------------- | ---------------------- |
| ≥1 relay accepted the recipient copy        | receipt                |
| self copy accepted, recipient copy rejected | `RecipientNotReached`  |
| nothing accepted                            | `NoRelayReachable`     |
| single-copy send, nothing accepted          | `WrapNotDelivered`     |
| plain event, nothing accepted               | `NoRelayAcceptedEvent` |

"Only my self copy landed" is never reported as success. A relay accepting the copy is not the peer reading it; the peer's client still has to receive and decode it. The transport never retries; when you need retries, use the [outbox](./outbox.md).

## Branded primitives

All in `domain/primitives.ts`. Each is an effect `Schema` with a brand, so a plain `string` does not type-check where a `Pubkey` is expected.

| Type             | Shape                          | Make one                                                                |
| ---------------- | ------------------------------ | ----------------------------------------------------------------------- |
| `Pubkey`         | 64 hex, on-curve               | `parsePubkey(str)`, `decodeNpub(str)`, `derivePubkey(key)`              |
| `NostrSecretKey` | 32 bytes in curve order        | `decodeNsec(str)`                                                       |
| `RumorId`        | 64 hex; identity of a message  | from receipts and facts                                                 |
| `WrapId`         | 64 hex; one signed wrap        | from `WrapDelivery.wrapId`, push payloads                               |
| `EventId`        | 64 hex; one signed plain event | from `PlainEventReceipt.eventId`                                        |
| `ClientId`       | non-empty string               | `ClientId.make(localId)`                                                |
| `RelayUrl`       | `ws://` or `wss://` with host  | `RelayUrl.make(str)` (throws) or `Schema.decodeUnknownOption(RelayUrl)` |
| `UnixSeconds`    | positive integer               | `UnixSeconds.make(n)`                                                   |
| `Emoji`          | trimmed, ≤32 chars             | `Emoji.make(str)`                                                       |

`X.make(value)` validates and throws on failure. `Schema.is(X)` is a type guard; `Schema.decodeUnknownOption(X)` returns an `Option`. Rumor ids and wrap ids are different things: wraps are regenerated on every publish, rumor ids are stable.

## Services and Layers

Capabilities enter as Effect services and the composition root supplies them:

| Service            | Provides                        | Layer                                             |
| ------------------ | ------------------------------- | ------------------------------------------------- |
| `LinkstrIdentity`  | `pubkey`, `secretKey`           | `LinkstrIdentity.fromSecretKey(key)`              |
| `RelayPolicy`      | `readRelays`, `writeRelays`     | `RelayPolicy.fixed({ readRelays, writeRelays })`  |
| `NostrTransport`   | `publish`, `subscribe`, `fetch` | `NostrTransportSimplePool` or a stub              |
| `OutboxStore`      | durable job list                | `OutboxStore.inMemory`, `.fromStringStorage`      |
| `InboxCursorStore` | persisted backfill cursor       | `InboxCursorStore.inMemory`, `.fromStringStorage` |
| `Inspector`        | optional diagnostics bus        | `Inspector.live`, `.disabled`, or none            |
| `RelayHealth`      | per-relay connection snapshot   | `RelayHealth.live`                                |

Vertical services (`Reactions`, `Chat`, `WrapInbox`, …) are `Effect.Service` classes with a `.Default` layer. `linkstrServices(config)` assembles all of them; `runLinkstr` and the react runtime both call it. You only build layers by hand in tests.

## Effect in five minutes

You need exactly this much Effect to use the package.

```ts
import { Effect, Stream } from "effect";
import { Reactions, WrapInbox } from "@linky/linkstr";

// An Effect<A, E, R> is a description of a computation: success A,
// typed failure E, required services R. Nothing runs until you run it.
const program = Effect.gen(function* () {
  const reactions = yield* Reactions; // yield* a service tag to get the service
  const inbox = yield* WrapInbox;
  return { reactions, inbox };
});
```

- `Effect.gen(function* () { … })` lets you write sequential code; `yield*` unwraps an Effect (or a service tag) and propagates its failure.
- Failures are values in the `E` channel. Handle them before the Promise boundary: `Effect.catchTags({ … })` handles named tags, `Effect.either` turns the result into `Either<A, E>`. `Effect.runPromise` rejects with anything you left unhandled, and the rejection is wrapped, so do not match on it as a tagged error.
- A `Layer<S>` builds a service `S`; `Effect.provide(effect, layer)` satisfies `R`. `Layer.mergeAll` combines layers; `Layer.provide` feeds one layer's outputs into another's inputs.
- A `Stream<A>` is a lazy sequence. Consume with `Stream.runForEach(stream, (a) => Effect…)`, or `Stream.take(n)` + `Stream.runCollect`.
- A `Scope` owns resources. Anything typed `Effect<…, …, Scope.Scope>` (like `inbox.open`) must run inside `Effect.scoped(…)`; leaving the scope releases it. `Effect.forkScoped` runs a fiber that dies with the scope.
- `Effect.timeoutOption("1 minute")` bounds an effect without failing it.

In React you never run effects yourself; fn atoms do it and hand you a `Result` or an `Exit` ([react.md](./react.md)).

## Errors are `Schema.TaggedError`

Every failure is a class with a `_tag` and serializable fields. Match on `_tag`, and persist them as-is when you need to (the outbox stores them on job rows).

```ts
import { Effect, Either } from "effect";
import { Reactions, type ReactionDraft } from "@linky/linkstr";

const describeFailure = (draft: ReactionDraft) =>
  Effect.flatMap(Reactions, (reactions) => reactions.react(draft)).pipe(
    Effect.catchTags({
      RecipientNotReached: (error) =>
        Effect.succeed(
          `peer copy rejected by ${error.recipientCopy.rejectedBy.length} relays`,
        ),
      NoRelayReachable: () => Effect.succeed("offline"),
    }),
  );

// Or keep the failure as a value and decide at the call site.
const reactOrExplain = (draft: ReactionDraft) =>
  Effect.flatMap(Reactions, (reactions) => reactions.react(draft)).pipe(
    Effect.either,
    Effect.map(
      Either.match({
        onLeft: (error) => `failed: ${error._tag}`,
        onRight: (receipt) => `sent ${receipt.rumorId}`,
      }),
    ),
  );
```

Other tags you will meet: `WrapNotDelivered`, `NoRelayAcceptedEvent`, `AllRelaysUnreachable` (one-shot fetch reached nobody), `NoReadRelaysConfigured`, `RelayUnreachable` (transport level), and `LinkstrNotConfigured` from linkstr-react.

## Related

- [getting-started.md](./getting-started.md)
- [inbox.md](./inbox.md) — the `WrapInboxEvent` union in full
- [outbox.md](./outbox.md) — durable sends and retries
- [../README.md](../README.md) — the rules and why they exist
