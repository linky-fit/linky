import { Registry } from "./index";
import { RelayListEntry, RelayListsDraft, RelayUrl } from "@linky/linkstr";
import type { SignedPlainEvent } from "@linky/linkstr";
import { stubPlainTransport } from "@linky/linkstr/testing";
import { Effect, Exit } from "effect";
import { finalizeEvent } from "nostr-tools";
import { linkstrConfigAtom } from "./config";
import { publishMuteListAtom } from "./muteList";
import { fetchOwnRelayListsAtom, publishRelayListsAtom } from "./relayLists";
import { configWith, makeIdentity, settle } from "./testing";

const alice = makeIdentity();
const bob = makeIdentity();

const relayOne = RelayUrl.make("wss://one.test");
const relayDm = RelayUrl.make("wss://dm.test");

describe("publishRelayListsAtom", () => {
  it("publishes both list kinds and returns the paired receipt", async () => {
    const registry = Registry.make();
    const published: Array<SignedPlainEvent> = [];
    registry.set(
      linkstrConfigAtom,
      configWith(alice, stubPlainTransport(published)),
    );

    registry.set(
      publishRelayListsAtom,
      new RelayListsDraft({
        relays: [new RelayListEntry({ relay: relayOne, marker: "write" })],
        dmRelays: [relayDm],
      }),
    );
    const exit = await settle(registry, publishRelayListsAtom);

    assert(Exit.isSuccess(exit));
    expect(exit.value.relayList.kind).toBe(10002);
    expect(exit.value.dmRelayList.kind).toBe(10050);
    expect(published.map((event) => event.kind).sort()).toEqual([10002, 10050]);
  });
});

describe("fetchOwnRelayListsAtom", () => {
  it("fetches the configured identity's lists", async () => {
    const registry = Registry.make();
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

    registry.set(fetchOwnRelayListsAtom, undefined);
    const exit = await settle(registry, fetchOwnRelayListsAtom);

    assert(Exit.isSuccess(exit));
    expect(exit.value.relays).toEqual([
      expect.objectContaining({ relay: relayOne, marker: "read" }),
    ]);
    expect(exit.value.dmRelays).toBeNull();
  });
});

describe("publishMuteListAtom", () => {
  it("publishes the mute list for the configured identity", async () => {
    const registry = Registry.make();
    const published: Array<SignedPlainEvent> = [];
    registry.set(
      linkstrConfigAtom,
      configWith(alice, stubPlainTransport(published)),
    );

    registry.set(publishMuteListAtom, [bob.pubkey]);
    const exit = await settle(registry, publishMuteListAtom);

    assert(Exit.isSuccess(exit));
    expect(exit.value.kind).toBe(10000);
    const event = published[0];
    expect(event?.pubkey).toBe(alice.pubkey);
    expect(event?.tags).toEqual([["p", bob.pubkey]]);
  });
});
