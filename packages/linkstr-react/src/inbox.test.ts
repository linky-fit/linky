import { Registry } from "./index";
import {
  ClientId,
  NIP59_BACKDATE_MARGIN_SECONDS,
  RetractionDraft,
  RumorId,
  UnixSeconds,
  WrapId,
} from "@linky/linkstr";
import type { LinkstrIdentityService, WrapInboxEvent } from "@linky/linkstr";
import { recipientOf } from "@linky/linkstr/testing";
import { Exit } from "effect";
import type { Event as NostrToolsEvent } from "nostr-tools";
import type { LinkstrConfig } from "./config";
import { linkstrConfigAtom } from "./config";
import {
  fetchWrapEventAtom,
  wrapInboxAtom,
  wrapInboxHandlerAtom,
} from "./inbox";
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
    const registry = Registry.make();
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
  const registry = Registry.make();
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
    const registry = Registry.make();
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

  it("backfills from the handler's since cursor", async () => {
    const registry = Registry.make();
    const subscriptions: Array<FakeSubscription> = [];
    const since = UnixSeconds.make(1_755_000_000);

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
    const registry = Registry.make();
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
