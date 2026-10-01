# Testing

Two helper sets give you throwaway identities, transport stubs, an in-memory relay and a polling helper, so a test runs in milliseconds with no network. `@linky-fit/linkstr/testing` is a public subpath of the linkstr package and needs Vitest 4 as an optional peer (`bun add --dev vitest`); `@linky-fit/linkstr-react/testing` is the same for linkstr-react. Never import either from production code. Build inbound fixtures through the public send API where you can, as below.

## `@linky-fit/linkstr/testing`

`makeIdentity()` gives a fresh `{ pubkey, secretKey }`. `stubWrapTransport(published, accept?, options?)` and `stubPlainTransport(...)` are `Layer<NostrTransport>`s that record every published event and let `accept(event, relay)` decide the outcome per relay; `recipientOf(event)` and `hasPushMarker(wrap)` read the recorded wraps. Stub transports `die` on `subscribe` and `fetch` unless you pass them in `options`; when a test needs subscriptions, put a `FakeRelay` behind `makeRelayPoolTransport(poolFor(fakes))` and drive it by hand with `emit`, `eose` and `closeFromRelay`. `eventually(predicate)` is `expect.poll` inside an Effect, and `stubStorage()` is a `StringStorage` over a `Map` for `OutboxStore` / `InboxCursorStore`.

## A send and an inbound test

Send from bob to alice through a recording stub, keep the copy addressed to alice, then feed it to alice's inbox through a `FakeRelay`:

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
  const asBob = Reactions.layer.pipe(
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
  const layer = WrapInbox.layer.pipe(
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

The `asBob` layer is also the shape of a plain send test: run the operation against it and assert on `published` (`published.map(recipientOf)` holds both copies of a two-copy send). To test the failure path, pass an `accept` function: `stubWrapTransport(published, (wrap) => recipientOf(wrap) === alice.pubkey)` accepts only the self copy, so `react` fails with `RecipientNotReached`.

`fake.emit` before `fake.eose()` yields `delivery: "backfill"`; after it, `"live"`. `fake.closeFromRelay("reason")` ends the subscription so you can watch the resubscribe loop; set `fake.down = true` to make `ensureRelay` reject.

## `@linky-fit/linkstr-react/testing`

`configWith(identity, transport, overrides?)` builds a `LinkstrConfig` on one relay (`relayA`) over the given transport layer; `settle(registry, fnAtom)` awaits the fn atom's `AsyncResult` as an `Exit`; `fakeTransport(published, subscriptions, stored?, fetchedFilters?)` (and `fakeTransportLayer`) accepts every publish, records subscriptions and serves `stored` to fetches. `relayA`, `relayB` and `makeIdentity` are re-exported. Drive atoms with a bare `AtomRegistry` instead of rendering:

```ts
import { ClientId, RetractionDraft, RumorId } from "@linky-fit/linkstr";
import { stubWrapTransport } from "@linky-fit/linkstr/testing";
import type { SignedWrapEvent } from "@linky-fit/linkstr/testing";
import {
  AtomRegistry,
  linkstrConfigAtom,
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
  const registry = AtomRegistry.make();
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
