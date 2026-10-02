import {
  EventId,
  FetchedMuteList,
  UnixSeconds,
  type Pubkey,
} from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { BLOCKED_NOSTR_PUBKEYS_STORAGE_KEY } from "../../utils/constants";
import {
  adoptMuteList,
  blockPubkey,
  isBlockedPubkey,
  mergeMuteList,
  readBlockList,
} from "./blockList";

const [alice, bob, carol] = [makeIdentity(), makeIdentity(), makeIdentity()];

const muteList = (pubkeys: ReadonlyArray<Pubkey>, createdAt: number) =>
  new FetchedMuteList({
    eventId: EventId.make("e".repeat(64)),
    pubkeys,
    createdAt: UnixSeconds.make(createdAt),
  });

describe("mergeMuteList", () => {
  it("adopts a list blocked on another device", () => {
    const merge = mergeMuteList([], muteList([alice.pubkey], 100));
    expect(merge.blockList).toEqual([alice.pubkey]);
    expect(merge.added).toEqual([alice.pubkey]);
    expect(merge.publish).toBe(false);
  });

  it("keeps every local entry, whatever the list says, and publishes the union", () => {
    const merge = mergeMuteList(
      [alice.pubkey, carol.pubkey],
      muteList([bob.pubkey], 100),
    );
    expect(new Set(merge.blockList)).toEqual(
      new Set([alice.pubkey, bob.pubkey, carol.pubkey]),
    );
    expect(merge.added).toEqual([bob.pubkey]);
    expect(merge.publish).toBe(true);
  });

  it("publishes nothing when the list already holds every local entry", () => {
    expect(
      mergeMuteList([bob.pubkey], muteList([alice.pubkey, bob.pubkey], 100))
        .publish,
    ).toBe(false);
  });

  it("publishes the local list when every relay answered without one", () => {
    expect(mergeMuteList([alice.pubkey], null).publish).toBe(true);
    expect(mergeMuteList([], null).publish).toBe(false);
  });
});

describe("block list storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("reads stored entries as normalized pubkeys", () => {
    localStorage.setItem(
      BLOCKED_NOSTR_PUBKEYS_STORAGE_KEY,
      JSON.stringify([alice.pubkey.toUpperCase(), "not-a-pubkey"]),
    );
    expect(readBlockList()).toEqual([alice.pubkey]);
    expect(isBlockedPubkey(alice.pubkey)).toBe(true);
  });

  it("blocks a pubkey once", () => {
    blockPubkey(alice.pubkey);
    blockPubkey(alice.pubkey);
    blockPubkey(bob.pubkey);
    expect(readBlockList()).toEqual([alice.pubkey, bob.pubkey]);
    expect(isBlockedPubkey(carol.pubkey)).toBe(false);
  });

  it("adds what the mute list brings to the stored list", () => {
    blockPubkey(alice.pubkey);
    adoptMuteList(muteList([bob.pubkey], 100));
    expect(readBlockList()).toEqual([alice.pubkey, bob.pubkey]);
  });
});
