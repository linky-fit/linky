import { AtomRegistry } from "./index";
import {
  ClientId,
  InboxCursorStore,
  NIP59_BACKDATE_MARGIN_SECONDS,
  RetractionDraft,
  RumorId,
  UnixSeconds,
  WrapId,
} from "@linky-fit/linkstr";
import type {
  InspectorEvent,
  LinkstrIdentityService,
  WrapInboxEvent,
} from "@linky-fit/linkstr";
import { recipientOf } from "@linky-fit/linkstr/testing";
import { Effect, Exit, Layer } from "effect";
import type { Event as NostrToolsEvent } from "nostr-tools";
import type { LinkstrConfig } from "./config";
import { linkstrConfigAtom } from "./config";
import {
  fetchWrapEventAtom,
  wrapInboxAtom,
  wrapInboxHandlerAtom,
} from "./inbox";
import { inspectorEventsAtom, inspectorHandlerAtom } from "./inspector";
import { retractReactionAtom } from "./reactions";
import {
  configWith,
  fakeTransportLayer,
  makeIdentity,
  relayA,
  relayB,
  settle,
} from "./testing";
import type { FakeSubscription, PublishedEvent } from "./testing";

const alice = makeIdentity();
const bob = makeIdentity();

const firstReaction = RumorId.make("ab".repeat(32));

describe("fetchWrapEventAtom", () => {
  it("returns a typed inbox event", async () => {
    const wrap = await wrapFromBob(firstReaction);
    const registry = AtomRegistry.make();
    registry.set(linkstrConfigAtom, twoRelayConfig(alice, [], [], [wrap]));
    registry.set(fetchWrapEventAtom, { wrapId: WrapId.make(wrap.id) });

    const exit = await settle(registry, fetchWrapEventAtom);

    expect(exit).toEqual(
      Exit.succeed(
        expect.objectContaining({
          _tag: "ReactionRetracted",
          from: bob.pubkey,
          reactionIds: [firstReaction],
        }),
      ),
    );
    registry.dispose();
  });
});

const twoRelayConfig = (
  identity: LinkstrIdentityService,
  ...transport: Parameters<typeof fakeTransportLayer>
): LinkstrConfig =>
  configWith(identity, fakeTransportLayer(...transport), {
    readRelays: [relayA, relayB],
    writeRelays: [relayA, relayB],
  });

/** A real inbound wrap for alice, produced through the public send API. */
const wrapFromBob = async (reactionId: RumorId): Promise<NostrToolsEvent> => {
  const registry = AtomRegistry.make();
  const published: Array<PublishedEvent> = [];
  registry.set(linkstrConfigAtom, twoRelayConfig(bob, published, []));
  registry.set(
    retractReactionAtom,
    new RetractionDraft({
      to: alice.pubkey,
      reactionIds: [reactionId],
      clientId: ClientId.make("client-inbox"),
    }),
  );
  const exit = await settle(registry, retractReactionAtom);
  assert(Exit.isSuccess(exit));
  registry.dispose();
  const wrap = published.find(
    (candidate) => recipientOf(candidate) === alice.pubkey,
  );
  assert(wrap !== undefined);
  return wrap;
};

describe("wrapInboxAtom", () => {
  it("feeds inbound wraps through the handler", async () => {
    const wrap = await wrapFromBob(firstReaction);
    const registry = AtomRegistry.make();
    const subscriptions: Array<FakeSubscription> = [];
    const handled: Array<WrapInboxEvent> = [];

    registry.set(linkstrConfigAtom, twoRelayConfig(alice, [], subscriptions));
    registry.set(wrapInboxHandlerAtom, {
      onEvent: (event) => {
        handled.push(event);
      },
    });
    const unmount = registry.mount(wrapInboxAtom);

    await expect.poll(() => subscriptions.length).toBe(2);
    expect(subscriptions[0]?.filter).toEqual({
      kinds: [1059],
      "#p": [alice.pubkey],
      since: expect.any(Number),
      limit: 1,
    });

    subscriptions[0]?.onEvent(wrap);
    await expect.poll(() => handled.length).toBe(1);
    expect(handled[0]).toEqual(
      expect.objectContaining({
        _tag: "ReactionRetracted",
        from: bob.pubkey,
        reactionIds: [firstReaction],
      }),
    );

    unmount();
  });

  it("confirms an event once its handler promise resolves, without holding the next one", async () => {
    const first = await wrapFromBob(firstReaction);
    const second = await wrapFromBob(RumorId.make("cd".repeat(32)));
    const registry = AtomRegistry.make();
    const subscriptions: Array<FakeSubscription> = [];
    const saved: Array<UnixSeconds> = [];
    const handled: Array<WrapInboxEvent> = [];
    let storeFirst = () => {};

    registry.set(linkstrConfigAtom, {
      ...twoRelayConfig(alice, [], subscriptions),
      inboxCursorStore: Layer.succeed(InboxCursorStore, {
        load: Effect.succeed(null),
        save: (cursor) => Effect.sync(() => saved.push(cursor)),
      }),
    });
    registry.set(wrapInboxHandlerAtom, {
      onEvent: (event) => {
        handled.push(event);
        if (handled.length > 1) return;
        return new Promise<void>((resolve) => {
          storeFirst = resolve;
        });
      },
    });
    const unmount = registry.mount(wrapInboxAtom);

    await expect.poll(() => subscriptions.length).toBe(2);
    for (const subscription of subscriptions) subscription.eose();
    subscriptions[0]?.onEvent(first);
    subscriptions[0]?.onEvent(second);
    await expect.poll(() => handled.length).toBe(2);
    expect(saved).toEqual([]);

    storeFirst();
    await expect
      .poll(() => saved)
      .toEqual([Math.max(first.created_at, second.created_at)]);

    unmount();
  });

  it("reports an event whose handler rejects and leaves it unconfirmed", async () => {
    const wrap = await wrapFromBob(firstReaction);
    const registry = AtomRegistry.make();
    const subscriptions: Array<FakeSubscription> = [];
    const saved: Array<UnixSeconds> = [];
    const seen: Array<InspectorEvent> = [];

    registry.set(linkstrConfigAtom, {
      ...twoRelayConfig(alice, [], subscriptions),
      inspector: true,
      inboxCursorStore: Layer.succeed(InboxCursorStore, {
        load: Effect.succeed(null),
        save: (cursor) => Effect.sync(() => saved.push(cursor)),
      }),
    });
    registry.set(inspectorHandlerAtom, {
      onEvent: (event) => {
        seen.push(event);
      },
    });
    const unmountInspector = registry.mount(inspectorEventsAtom);
    registry.set(wrapInboxHandlerAtom, {
      onEvent: () => Promise.reject(new Error("store unavailable")),
    });
    const unmount = registry.mount(wrapInboxAtom);

    await expect.poll(() => subscriptions.length).toBe(2);
    for (const subscription of subscriptions) subscription.eose();
    subscriptions[0]?.onEvent(wrap);

    await expect
      .poll(() => seen.find((event) => event._tag === "InboxEventUnconfirmed"))
      .toEqual(
        expect.objectContaining({
          wrapId: wrap.id,
          eventTag: "ReactionRetracted",
          error: "store unavailable",
        }),
      );
    expect(saved).toEqual([]);

    unmount();
    unmountInspector();
    registry.dispose();
  });

  it("backfills from the handler's since cursor", async () => {
    const registry = AtomRegistry.make();
    const subscriptions: Array<FakeSubscription> = [];
    const since = UnixSeconds.make(Math.floor(Date.now() / 1000) - 3600);

    registry.set(linkstrConfigAtom, twoRelayConfig(alice, [], subscriptions));
    registry.set(wrapInboxHandlerAtom, { since, onEvent: () => {} });
    const unmount = registry.mount(wrapInboxAtom);

    await expect.poll(() => subscriptions.length).toBe(2);
    expect(subscriptions[0]?.filter.since).toBe(
      since - NIP59_BACKDATE_MARGIN_SECONDS,
    );

    unmount();
  });

  it("stays closed without a handler and closes subscriptions on unmount", async () => {
    const registry = AtomRegistry.make();
    const subscriptions: Array<FakeSubscription> = [];

    registry.set(linkstrConfigAtom, twoRelayConfig(alice, [], subscriptions));
    const unmount = registry.mount(wrapInboxAtom);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(subscriptions).toHaveLength(0);

    registry.set(wrapInboxHandlerAtom, { onEvent: () => {} });
    await expect.poll(() => subscriptions.length).toBe(2);

    unmount();
    await expect.poll(() => subscriptions.length).toBe(0);
  });
});
