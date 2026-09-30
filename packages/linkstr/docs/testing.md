# Testing

Two helper sets give you throwaway identities, transport stubs, an in-memory relay and a polling helper, so a test runs in milliseconds with no network:

- `@linky-fit/linkstr/testing`, a public subpath of the linkstr package. It requires Vitest 4 as an optional peer (`bun add --dev vitest`); the main entry does not.
- `@linky-fit/linkstr-react/testing`, the same for linkstr-react: `configWith`, `settle`, `fakeTransport`, `fakeTransportLayer`, `relayA`, `relayB`, and a re-export of `makeIdentity`.

Never import either from production code. Build inbound fixtures through the public send API where you can, as below.

## `@linky-fit/linkstr/testing`

| Helper                                             | Use                                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `makeIdentity()`                                   | fresh `{ pubkey, secretKey }`                                                                          |
| `stubWrapTransport(published, accept?, options?)`  | `Layer<NostrTransport>` recording every wrap into `published`; `accept(wrap, relay)` decides per relay |
| `stubWrapTransportService(...)`                    | the same as a service value, for custom layers                                                         |
| `stubPlainTransport(published, accept?, options?)` | the plain-event twin (profiles, relay lists, mute list)                                                |
| `recipientOf(event)`                               | first `p` tag of a wrap                                                                                |
| `hasPushMarker(wrap)`                              | whether the `["linky","push"]` tag is present                                                          |
| `FakeRelay`, `poolFor(fakes)`                      | in-memory relay behind `makeRelayPoolTransport`; you call `emit`, `eose`, `closeFromRelay`             |
| `eventually(predicate)`                            | `expect.poll` inside an Effect                                                                         |
| `stubStorage()`                                    | `StringStorage` over a `Map`, for `OutboxStore` / `InboxCursorStore`                                   |
| `SignedWrapEvent`, `SignedPlainEvent` (types)      | for typing `published` arrays                                                                          |

Stub transports `die` on `subscribe` and `fetch` unless you pass them in `options`; use `FakeRelay` when a test needs subscriptions.

## A send test

```ts
import { Effect, Exit, Layer } from "effect";
import {
  ClientId,
  Emoji,
  LinkstrIdentity,
  ReactionDraft,
  Reactions,
  RelayPolicy,
  RelayUrl,
  RumorId,
} from "@linky-fit/linkstr";
import {
  makeIdentity,
  recipientOf,
  stubWrapTransport,
} from "@linky-fit/linkstr/testing";
import type { SignedWrapEvent } from "@linky-fit/linkstr/testing";

const alice = makeIdentity();
const bob = makeIdentity();
const relay = RelayUrl.make("wss://relay.test");

it("wraps the reaction to self and to the peer", async () => {
  const published: Array<SignedWrapEvent> = [];
  const layer = Reactions.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        LinkstrIdentity.fromSecretKey(alice.secretKey),
        RelayPolicy.fixed({ readRelays: [relay], writeRelays: [relay] }),
        stubWrapTransport(published),
      ),
    ),
  );

  const exit = await Effect.runPromiseExit(
    Effect.flatMap(Reactions, (reactions) =>
      reactions.react(
        new ReactionDraft({
          to: bob.pubkey,
          target: RumorId.make("ab".repeat(32)),
          targetKind: "text",
          targetAuthor: bob.pubkey,
          emoji: Emoji.make("🔥"),
          clientId: ClientId.make("client-42"),
        }),
      ),
    ).pipe(Effect.provide(layer)),
  );

  assert(Exit.isSuccess(exit));
  expect(exit.value.clientId).toBe("client-42");
  expect(published.map(recipientOf)).toEqual(
    expect.arrayContaining([alice.pubkey, bob.pubkey]),
  );
});
```

To test the failure path, pass an `accept` function: `stubWrapTransport(published, (wrap) => recipientOf(wrap) === alice.pubkey)` accepts only the self copy, so `react` fails with `RecipientNotReached`.

## An inbound test

Build a real wrap with the public API: send from bob to alice through a recording stub and keep the copy addressed to alice. Then feed it to alice's inbox through a `FakeRelay`.

```ts
import { Duration, Effect, Layer, Stream } from "effect";
import {
  Emoji,
  InboxCursorStore,
  LinkstrIdentity,
  makeRelayPoolTransport,
  NostrTransport,
  ReactionDraft,
  Reactions,
  RelayPolicy,
  RelayUrl,
  RumorId,
  WrapInbox,
  type WrapInboxEvent,
} from "@linky-fit/linkstr";
import {
  eventually,
  FakeRelay,
  makeIdentity,
  poolFor,
  recipientOf,
  stubWrapTransport,
} from "@linky-fit/linkstr/testing";
import type { SignedWrapEvent } from "@linky-fit/linkstr/testing";

const alice = makeIdentity();
const bob = makeIdentity();
const relay = RelayUrl.make("wss://relay.test");

const wrapFromBob = async (): Promise<SignedWrapEvent> => {
  const published: Array<SignedWrapEvent> = [];
  const asBob = Reactions.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        LinkstrIdentity.fromSecretKey(bob.secretKey),
        RelayPolicy.fixed({ readRelays: [relay], writeRelays: [relay] }),
        stubWrapTransport(published),
      ),
    ),
  );
  await Effect.runPromise(
    Effect.flatMap(Reactions, (reactions) =>
      reactions.react(
        new ReactionDraft({
          to: alice.pubkey,
          target: RumorId.make("ab".repeat(32)),
          targetKind: "text",
          targetAuthor: alice.pubkey,
          emoji: Emoji.make("🔥"),
        }),
      ),
    ).pipe(Effect.provide(asBob)),
  );
  const wrap = published.find((event) => recipientOf(event) === alice.pubkey);
  assert(wrap !== undefined);
  return wrap;
};

it("routes a wrap into a typed fact", async () => {
  const wrap = await wrapFromBob();
  const fake = new FakeRelay();
  const layer = WrapInbox.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        LinkstrIdentity.fromSecretKey(alice.secretKey),
        RelayPolicy.fixed({ readRelays: [relay], writeRelays: [] }),
        Layer.succeed(
          NostrTransport,
          makeRelayPoolTransport(poolFor(new Map([[relay, fake]]))),
        ),
        InboxCursorStore.inMemory,
      ),
    ),
  );

  const seen = await Effect.gen(function* () {
    const inbox = yield* WrapInbox;
    const feed = yield* inbox.open({ resubscribeDelay: Duration.millis(10) });
    const collected: Array<WrapInboxEvent> = [];
    yield* Effect.forkScoped(
      Stream.runForEach(feed.events, ({ event }) =>
        Effect.sync(() => collected.push(event)),
      ),
    );
    yield* eventually(() => fake.subscriptions.length === 1);
    fake.eose();
    fake.emit(wrap);
    yield* eventually(() => collected.length === 1);
    return collected;
  }).pipe(Effect.scoped, Effect.provide(layer), Effect.runPromise);

  expect(seen[0]?._tag).toBe("ReactionAdded");
});
```

`fake.emit` before `fake.eose()` yields `delivery: "backfill"`; after it, `"live"`. `fake.closeFromRelay("reason")` ends the subscription so you can watch the resubscribe loop; set `fake.down = true` to make `ensureRelay` reject.

## `@linky-fit/linkstr-react/testing`

| Helper                                                              | Use                                                                      |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `configWith(identity, transport, overrides?)`                       | a `LinkstrConfig` on one relay (`relayA`) over the given transport layer |
| `settle(registry, fnAtom)`                                          | awaits the fn atom's `Result` as an `Exit`                               |
| `fakeTransport(published, subscriptions, stored?, fetchedFilters?)` | accepts every publish, records subscriptions, serves `stored` to fetches |
| `fakeTransportLayer(...)`                                           | the same as a `Layer<NostrTransport>`                                    |
| `relayA`, `relayB`                                                  | `wss://relay-a.test`, `wss://relay-b.test`                               |
| `makeIdentity`                                                      | re-exported                                                              |

Drive atoms with a bare `Registry` instead of rendering:

```ts
import { ClientId, RetractionDraft, RumorId } from "@linky-fit/linkstr";
import { stubWrapTransport } from "@linky-fit/linkstr/testing";
import type { SignedWrapEvent } from "@linky-fit/linkstr/testing";
import {
  linkstrConfigAtom,
  Registry,
  retractReactionAtom,
} from "@linky-fit/linkstr-react";
import {
  configWith,
  makeIdentity,
  settle,
} from "@linky-fit/linkstr-react/testing";
import { Exit } from "effect";

it("retracts through the configured transport", async () => {
  const alice = makeIdentity();
  const bob = makeIdentity();
  const registry = Registry.make();
  const published: Array<SignedWrapEvent> = [];
  registry.set(
    linkstrConfigAtom,
    configWith(alice, stubWrapTransport(published)),
  );

  registry.set(
    retractReactionAtom,
    new RetractionDraft({
      to: bob.pubkey,
      reactionIds: [RumorId.make("ab".repeat(32))],
      clientId: ClientId.make("client-42"),
    }),
  );
  const exit = await settle(registry, retractReactionAtom);

  assert(Exit.isSuccess(exit));
  expect(published).toHaveLength(2);
  registry.dispose();
});
```

For stream atoms (`wrapInboxAtom`, `outboxResultsAtom`, `relayHealthAtom`), set the handler atom, then `registry.mount(atom)` and `expect.poll` on what the handler collected; unmount at the end.

## Related

- [inbox.md](./inbox.md), [outbox.md](./outbox.md) — what the fakes are driving
- [react.md](./react.md)
