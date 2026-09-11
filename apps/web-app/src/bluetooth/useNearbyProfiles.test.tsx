import { act } from "react";
import { describe, expect, it } from "vitest";
import { encodeNpub, NostrTransport } from "@linky/linkstr";
import {
  fetchProfilesAtom,
  linkstrConfigAtom,
  Registry,
  RegistryContext,
} from "@linky/linkstr-react";
import {
  configWith,
  fakeTransport,
  makeIdentity,
  settle,
} from "@linky/linkstr-react/testing";
import { Effect, Exit, Layer } from "effect";
import { finalizeEvent } from "nostr-tools";
import { loadCachedProfile } from "../profileCache";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { useNearbyProfiles } from "./useNearbyProfiles";

const Profiles = ({ npubs }: { npubs: readonly string[] }) => {
  const profiles = useNearbyProfiles(npubs, true);
  return (
    <div>
      {profiles.map((profile) => (
        <span key={profile.npub}>{profile.name}</span>
      ))}
    </div>
  );
};

describe("nearby profile fetch isolation", () => {
  it("finishes staggered peers independently from another shared profile lookup", async () => {
    const alice = makeIdentity();
    const bob = makeIdentity();
    const carol = makeIdentity();
    const events = [alice, bob, carol].map((identity, index) =>
      finalizeEvent(
        {
          kind: 0,
          tags: [],
          created_at: 10,
          content: JSON.stringify({ name: `Peer ${index}` }),
        },
        identity.secretKey,
      ),
    );
    const transport = fakeTransport([], [], events);
    const gates = new Map<string, () => void>();
    const started: string[] = [];
    const delayed = Layer.succeed(NostrTransport, {
      ...transport,
      fetch: (relay, filter) =>
        Effect.gen(function* () {
          const key = filter.authors?.join(",") ?? "";
          started.push(key);
          yield* Effect.async<void>((resume) => {
            gates.set(key, () => resume(Effect.void));
          });
          return yield* transport.fetch(relay, filter);
        }),
    });
    const registry = Registry.make();
    const releaseConfig = registry.mount(linkstrConfigAtom);
    const releaseShared = registry.mount(fetchProfilesAtom);
    registry.set(linkstrConfigAtom, configWith(makeIdentity(), delayed));
    const page = (npubs: readonly string[]) => (
      <RegistryContext.Provider value={registry}>
        <Profiles npubs={npubs} />
      </RegistryContext.Provider>
    );
    const aliceNpub = encodeNpub(alice.pubkey);
    const bobNpub = encodeNpub(bob.pubkey);
    const rendered = await renderIntoDocument(page([aliceNpub]));
    try {
      await expect.poll(() => gates.has(alice.pubkey)).toBe(true);
      await rendered.rerender(page([aliceNpub, bobNpub]));
      expect(started).toEqual([alice.pubkey]);

      registry.set(fetchProfilesAtom, [carol.pubkey]);
      const otherResult = settle(registry, fetchProfilesAtom);
      await expect.poll(() => gates.has(carol.pubkey)).toBe(true);
      await act(async () => {
        gates.get(carol.pubkey)?.();
      });
      const otherExit = await otherResult;
      expect(Exit.isSuccess(otherExit) && otherExit.value[0]?.pubkey).toBe(
        carol.pubkey,
      );
      expect(loadCachedProfile(aliceNpub)).toBeNull();

      await act(async () => {
        gates.get(alice.pubkey)?.();
      });
      await expect.poll(() => gates.has(bob.pubkey)).toBe(true);
      await act(async () => {
        gates.get(bob.pubkey)?.();
      });
      await act(async () => {
        await expect
          .poll(() => loadCachedProfile(bobNpub)?.metadata.name)
          .toBe("Peer 1");
      });
      expect(loadCachedProfile(aliceNpub)?.metadata.name).toBe("Peer 0");
      expect(rendered.container.textContent).toContain("Peer 0");
      expect(rendered.container.textContent).toContain("Peer 1");
      expect(started).toEqual([alice.pubkey, carol.pubkey, bob.pubkey]);
    } finally {
      await rendered.unmount();
      releaseShared();
      releaseConfig();
      registry.dispose();
    }
  });
});
