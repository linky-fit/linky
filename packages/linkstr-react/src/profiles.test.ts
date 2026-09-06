import { Registry } from "./index";
import { ProfileMetadata, StatusDraft, UnixSeconds } from "@linky/linkstr";
import type { LinkstrIdentityService, ProfileWatchEvent } from "@linky/linkstr";
import { Exit } from "effect";
import { finalizeEvent } from "nostr-tools";
import type { Event as NostrToolsEvent } from "nostr-tools";
import { linkstrConfigAtom } from "./config";
import {
  discoverActiveProfilesAtom,
  fetchProfileAtom,
  profileWatchAtom,
  profileWatchHandlerAtom,
  publishProfileAtom,
  publishStatusAtom,
  watchedProfilesAtom,
} from "./profiles";
import {
  configWith,
  fakeTransportLayer,
  makeIdentity,
  settle,
} from "./testing";
import type { FakeSubscription, PublishedEvent } from "./testing";

const alice = makeIdentity();
const bob = makeIdentity();
const carol = makeIdentity();

const base = 1_754_000_000;

const profileEvent = (
  identity: LinkstrIdentityService,
  content: string,
  createdAt: number,
): NostrToolsEvent =>
  finalizeEvent(
    { kind: 0, tags: [], content, created_at: createdAt },
    identity.secretKey,
  );

describe("profileWatchAtom", () => {
  it("feeds facts through the handler and resubscribes when the set changes", async () => {
    const registry = Registry.make();
    const subscriptions: Array<FakeSubscription> = [];
    const handled: Array<ProfileWatchEvent> = [];

    registry.set(
      linkstrConfigAtom,
      configWith(alice, fakeTransportLayer([], subscriptions)),
    );
    registry.set(profileWatchHandlerAtom, {
      onEvent: (event) => {
        handled.push(event);
      },
    });
    const unmount = registry.mount(profileWatchAtom);

    // No watched pubkeys yet: the subscription stays closed.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(subscriptions).toHaveLength(0);

    registry.set(watchedProfilesAtom, [bob.pubkey]);
    await expect.poll(() => subscriptions.length).toBe(1);
    expect(subscriptions[0]?.filter).toEqual({
      kinds: [0, 30315],
      authors: [bob.pubkey],
    });

    subscriptions[0]?.onEvent(
      profileEvent(bob, JSON.stringify({ name: "bob" }), base + 1),
    );
    await expect.poll(() => handled.length).toBe(1);
    expect(handled[0]).toEqual(
      expect.objectContaining({
        _tag: "ProfileUpdated",
        pubkey: bob.pubkey,
        metadata: expect.objectContaining({ name: "bob" }),
      }),
    );

    // Growing the set replaces the subscription without a runtime rebuild.
    registry.set(watchedProfilesAtom, [bob.pubkey, carol.pubkey]);
    await expect
      .poll(() => subscriptions[0]?.filter.authors)
      .toEqual([bob.pubkey, carol.pubkey]);
    expect(subscriptions).toHaveLength(1);

    unmount();
    await expect.poll(() => subscriptions.length).toBe(0);
  });
});

describe("fetchProfileAtom", () => {
  it("returns the typed fetch result", async () => {
    const registry = Registry.make();
    registry.set(
      linkstrConfigAtom,
      configWith(
        alice,
        fakeTransportLayer(
          [],
          [],
          [profileEvent(bob, JSON.stringify({ display_name: "Bob" }), base)],
        ),
      ),
    );

    registry.set(fetchProfileAtom, bob.pubkey);
    const exit = await settle(registry, fetchProfileAtom);

    assert(Exit.isSuccess(exit));
    expect(exit.value).toEqual(
      expect.objectContaining({
        profile: expect.objectContaining({
          pubkey: bob.pubkey,
          metadata: expect.objectContaining({ displayName: "Bob" }),
        }),
        status: null,
      }),
    );
  });
});

describe("discoverActiveProfilesAtom", () => {
  it("returns recently active authors with decoded profiles", async () => {
    const registry = Registry.make();
    registry.set(
      linkstrConfigAtom,
      configWith(
        alice,
        fakeTransportLayer(
          [],
          [],
          [
            finalizeEvent(
              { kind: 1, tags: [], content: "note", created_at: base + 5 },
              bob.secretKey,
            ),
            profileEvent(bob, JSON.stringify({ display_name: "Bob" }), base),
          ],
        ),
      ),
    );

    registry.set(discoverActiveProfilesAtom, undefined);
    const exit = await settle(registry, discoverActiveProfilesAtom);

    assert(Exit.isSuccess(exit));
    expect(exit.value).toEqual([
      expect.objectContaining({
        pubkey: bob.pubkey,
        lastActiveAt: base + 5,
        metadata: expect.objectContaining({ displayName: "Bob" }),
      }),
    ]);
  });
});

describe("publishProfileAtom / publishStatusAtom", () => {
  it("publishes through the configured transport and returns receipts", async () => {
    const registry = Registry.make();
    const published: Array<PublishedEvent> = [];
    registry.set(
      linkstrConfigAtom,
      configWith(alice, fakeTransportLayer(published, [])),
    );

    registry.set(publishProfileAtom, new ProfileMetadata({ name: "alice" }));
    const profileExit = await settle(registry, publishProfileAtom);
    expect(Exit.isSuccess(profileExit)).toBe(true);

    registry.set(
      publishStatusAtom,
      new StatusDraft({
        content: "stacking",
        expiresAt: UnixSeconds.make(base + 60),
      }),
    );
    const statusExit = await settle(registry, publishStatusAtom);
    expect(Exit.isSuccess(statusExit)).toBe(true);

    expect(published.map((event) => event.kind)).toEqual([0, 30315]);
  });
});
