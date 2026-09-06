import { Registry } from "./index";
import {
  ClientId,
  NostrTransport,
  RetractionDraft,
  RumorId,
} from "@linky/linkstr";
import {
  recipientOf,
  stubWrapTransport,
  stubWrapTransportService,
} from "@linky/linkstr/testing";
import type { SignedWrapEvent } from "@linky/linkstr/testing";
import { Effect, Exit, Layer } from "effect";
import { linkstrConfigAtom } from "./config";
import { retractReactionAtom } from "./reactions";
import { configWith, makeIdentity, relayA, relayB, settle } from "./testing";

const alice = makeIdentity();
const bob = makeIdentity();
const carol = makeIdentity();

const draft = new RetractionDraft({
  to: carol.pubkey,
  reactionIds: [RumorId.make("ab".repeat(32))],
  clientId: ClientId.make("client-42"),
});

/** Transport stub with an observable scope, to prove runtime rebuilds dispose it. */
const disposableTransport = (
  published: Array<SignedWrapEvent>,
  onDispose: () => void,
): Layer.Layer<NostrTransport> =>
  Layer.scoped(
    NostrTransport,
    Effect.acquireRelease(
      Effect.sync(() => stubWrapTransportService(published)),
      () => Effect.sync(onDispose),
    ),
  );

const twoRelays = {
  readRelays: [relayA, relayB],
  writeRelays: [relayA, relayB],
};

const retract = (registry: Registry.Registry, retraction: RetractionDraft) => {
  registry.set(retractReactionAtom, retraction);
  return settle(registry, retractReactionAtom);
};

describe("retractReactionAtom", () => {
  it("delivers via the configured transport and returns a receipt", async () => {
    const registry = Registry.make();
    const published: Array<SignedWrapEvent> = [];
    registry.set(
      linkstrConfigAtom,
      configWith(alice, stubWrapTransport(published), twoRelays),
    );

    const exit = await retract(registry, draft);

    assert(Exit.isSuccess(exit));
    expect(exit.value.clientId).toBe("client-42");
    expect(exit.value.rumorId).toMatch(/^[0-9a-f]{64}$/);

    expect(published).toHaveLength(2);
    const recipients = published.map(recipientOf);
    expect(recipients).toContain(alice.pubkey);
    expect(recipients).toContain(carol.pubkey);
  });

  it("fails with LinkstrNotConfigured while logged out", async () => {
    const registry = Registry.make();

    const exit = await retract(registry, draft);

    expect(exit).toEqual(
      Exit.fail(expect.objectContaining({ _tag: "LinkstrNotConfigured" })),
    );
  });

  it("rebuilds the runtime on config change and disposes the old one", async () => {
    const registry = Registry.make();
    const unmount = registry.mount(retractReactionAtom);
    const disposed: Array<string> = [];
    const publishedAsAlice: Array<SignedWrapEvent> = [];
    const publishedAsBob: Array<SignedWrapEvent> = [];

    registry.set(
      linkstrConfigAtom,
      configWith(
        alice,
        disposableTransport(publishedAsAlice, () => disposed.push("alice")),
      ),
    );
    await retract(registry, draft);
    expect(publishedAsAlice.map(recipientOf)).toContain(alice.pubkey);

    registry.set(
      linkstrConfigAtom,
      configWith(
        bob,
        disposableTransport(publishedAsBob, () => disposed.push("bob")),
      ),
    );
    const exit = await retract(registry, draft);

    expect(Exit.isSuccess(exit)).toBe(true);
    // The self copy now seals to bob: the new identity signed the send.
    expect(publishedAsBob.map(recipientOf)).toContain(bob.pubkey);
    expect(publishedAsBob.map(recipientOf)).not.toContain(alice.pubkey);
    await expect.poll(() => disposed).toEqual(["alice"]);

    unmount();
  });
});
