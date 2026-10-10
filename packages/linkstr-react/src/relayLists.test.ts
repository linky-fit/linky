import { AtomRegistry } from "./index";
import { RelayListEntry, RelayListsDraft, RelayUrl } from "@linky-fit/linkstr";
import type { SignedPlainEvent } from "@linky-fit/linkstr";
import { stubPlainTransport } from "@linky-fit/linkstr/testing";
import { Effect, Exit } from "effect";
import { finalizeEvent } from "nostr-tools";
import { linkstrCommands } from "./commands";
import { linkstrConfigAtom } from "./config";
import { configWith, makeIdentity } from "./testing";

const alice = makeIdentity();
const bob = makeIdentity();

const relayOne = RelayUrl.make("wss://one.test");
const relayDm = RelayUrl.make("wss://dm.test");

describe("publishRelayLists", () => {
  it("publishes both list kinds and returns the paired receipt", async () => {
    const registry = AtomRegistry.make();
    const published: Array<SignedPlainEvent> = [];
    registry.set(
      linkstrConfigAtom,
      configWith(alice, stubPlainTransport(published)),
    );

    const exit = await linkstrCommands(registry).publishRelayLists(
      new RelayListsDraft({
        relays: [new RelayListEntry({ relay: relayOne, marker: "write" })],
        dmRelays: [relayDm],
      }),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.relayList.kind).toBe(10002);
    expect(exit.value.dmRelayList.kind).toBe(10050);
    expect(published.map((event) => event.kind).sort()).toEqual([10002, 10050]);
  });
});

describe("fetchOwnRelayLists", () => {
  it("fetches the configured identity's lists", async () => {
    const registry = AtomRegistry.make();
    const stored = [
      finalizeEvent(
        {
          kind: 10002,
          tags: [["r", relayOne, "read"]],
          content: "",
          created_at: 1_754_000_000,
        },
        alice.secretKey,
      ),
    ];
    registry.set(
      linkstrConfigAtom,
      configWith(
        alice,
        stubPlainTransport([], () => true, {
          fetch: () => Effect.succeed(stored),
        }),
      ),
    );

    const exit = await linkstrCommands(registry).fetchOwnRelayLists();

    assert(Exit.isSuccess(exit));
    expect(exit.value.relays).toEqual([
      expect.objectContaining({ relay: relayOne, marker: "read" }),
    ]);
    expect(exit.value.dmRelays).toBeNull();
  });
});

describe("publishMuteList", () => {
  it("publishes the mute list for the configured identity", async () => {
    const registry = AtomRegistry.make();
    const published: Array<SignedPlainEvent> = [];
    registry.set(
      linkstrConfigAtom,
      configWith(alice, stubPlainTransport(published)),
    );

    const exit = await linkstrCommands(registry).publishMuteList([bob.pubkey]);

    assert(Exit.isSuccess(exit));
    expect(exit.value.kind).toBe(10000);
    const event = published[0];
    expect(event?.pubkey).toBe(alice.pubkey);
    expect(event?.tags).toEqual([["p", bob.pubkey]]);
  });
});
