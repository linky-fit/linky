// @vitest-environment jsdom
import {
  EventId,
  FetchedMuteList,
  MuteListChange,
  UnixSeconds,
  type Pubkey,
} from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BLOCKED_NOSTR_PUBKEYS_STORAGE_KEY } from "../../utils/constants";
import {
  adoptMuteList,
  blockPubkey,
  isBlockedPubkey,
  mergeMuteList,
  readBlockChanges,
  readBlockList,
  subscribeBlockList,
  toMuteListChanges,
  unblockPubkey,
  type BlockChange,
} from "./blockList";

const [alice, bob, carol] = [makeIdentity(), makeIdentity(), makeIdentity()];

const change = (pubkey: Pubkey, muted: boolean, at: number) =>
  new MuteListChange({ pubkey, muted, at: UnixSeconds.make(at) });

const muteList = (
  pubkeys: ReadonlyArray<Pubkey>,
  createdAt: number,
  changes: ReadonlyArray<MuteListChange> = [],
) =>
  new FetchedMuteList({
    eventId: EventId.make("e".repeat(64)),
    pubkeys,
    changes,
    createdAt: UnixSeconds.make(createdAt),
  });

const local = (...entries: Array<[Pubkey, BlockChange]>) => new Map(entries);

describe("mergeMuteList", () => {
  it("adopts a list blocked on another device", () => {
    const merge = mergeMuteList(local(), muteList([alice.pubkey], 100));
    expect(merge.blockList).toEqual([alice.pubkey]);
    expect(merge.added).toEqual([alice.pubkey]);
    expect(merge.publish).toBe(false);
  });

  it("keeps every block from either side and publishes the union", () => {
    const merge = mergeMuteList(
      local([carol.pubkey, { blocked: true, at: 50 }]),
      muteList([bob.pubkey], 100),
    );
    expect(new Set(merge.blockList)).toEqual(
      new Set([bob.pubkey, carol.pubkey]),
    );
    expect(merge.added).toEqual([bob.pubkey]);
    expect(merge.publish).toBe(true);
  });

  it("publishes nothing when the list holds the same changes", () => {
    expect(
      mergeMuteList(
        local([alice.pubkey, { blocked: true, at: 50 }]),
        muteList([alice.pubkey], 100, [change(alice.pubkey, true, 50)]),
      ).publish,
    ).toBe(false);
  });

  it("publishes the local changes when every relay answered without a list", () => {
    expect(
      mergeMuteList(local([alice.pubkey, { blocked: true, at: 50 }]), null)
        .publish,
    ).toBe(true);
    expect(mergeMuteList(local(), null).publish).toBe(false);
  });

  it("publishes a local unblock over the block it replaces", () => {
    const merge = mergeMuteList(
      local([alice.pubkey, { blocked: false, at: 120 }]),
      muteList([alice.pubkey], 100, [change(alice.pubkey, true, 90)]),
    );
    expect(merge.blockList).toEqual([]);
    expect(merge.publish).toBe(true);
  });

  it("adopts a later unblock from another device", () => {
    const merge = mergeMuteList(
      local([alice.pubkey, { blocked: true, at: 90 }]),
      muteList([], 130, [change(alice.pubkey, false, 120)]),
    );
    expect(merge.blockList).toEqual([]);
    expect(merge.removed).toEqual([alice.pubkey]);
    expect(merge.publish).toBe(false);
  });

  it("keeps a block that a concurrently published list never saw", () => {
    const merge = mergeMuteList(
      local([alice.pubkey, { blocked: true, at: 101 }]),
      muteList([bob.pubkey], 101, [change(bob.pubkey, true, 101)]),
    );
    expect(new Set(merge.blockList)).toEqual(
      new Set([alice.pubkey, bob.pubkey]),
    );
    expect(merge.removed).toEqual([]);
    expect(merge.publish).toBe(true);
  });

  it("keeps a local unblock over a list that still holds the older block", () => {
    const merge = mergeMuteList(
      local(
        [alice.pubkey, { blocked: false, at: 120 }],
        [bob.pubkey, { blocked: true, at: 60 }],
      ),
      muteList([alice.pubkey, bob.pubkey, carol.pubkey], 110, [
        change(alice.pubkey, true, 90),
        change(bob.pubkey, true, 60),
        change(carol.pubkey, true, 110),
      ]),
    );
    expect(new Set(merge.blockList)).toEqual(
      new Set([bob.pubkey, carol.pubkey]),
    );
    expect(merge.publish).toBe(true);
  });

  it("dates the entries of a list without timed changes when it was signed", () => {
    const merge = mergeMuteList(
      local(
        [alice.pubkey, { blocked: false, at: 120 }],
        [bob.pubkey, { blocked: false, at: 300 }],
      ),
      muteList([alice.pubkey, bob.pubkey], 200),
    );
    expect(merge.blockList).toEqual([alice.pubkey]);
    expect(merge.publish).toBe(true);
  });

  it("treats a p entry without a time in a Linky list as the oldest block", () => {
    const merge = mergeMuteList(
      local([alice.pubkey, { blocked: false, at: 120 }]),
      muteList([alice.pubkey, bob.pubkey], 200, [
        change(bob.pubkey, true, 150),
      ]),
    );
    expect(merge.blockList).toEqual([bob.pubkey]);
  });

  it("keeps a pending block over an unblock a clock running ahead dated later", () => {
    const merge = mergeMuteList(
      local([alice.pubkey, { blocked: true, at: 100, pending: true }]),
      muteList([], 220, [change(alice.pubkey, false, 220)]),
    );
    expect(merge.blockList).toEqual([alice.pubkey]);
    expect(merge.changes.get(alice.pubkey)).toEqual({
      blocked: true,
      at: 221,
      pending: true,
    });
    expect(merge.publish).toBe(true);
  });

  it("lets a confirmed block follow a later unblock", () => {
    const merge = mergeMuteList(
      local([alice.pubkey, { blocked: true, at: 100 }]),
      muteList([], 220, [change(alice.pubkey, false, 220)]),
    );
    expect(merge.blockList).toEqual([]);
  });

  it("takes another client's edit of the public entries at the list's time", () => {
    const merge = mergeMuteList(
      local(
        [alice.pubkey, { blocked: true, at: 90 }],
        [bob.pubkey, { blocked: false, at: 90 }],
      ),
      muteList([bob.pubkey], 200, [
        change(alice.pubkey, true, 90),
        change(bob.pubkey, false, 90),
      ]),
    );
    expect(merge.blockList).toEqual([bob.pubkey]);
    expect(merge.changes.get(alice.pubkey)).toEqual({
      blocked: false,
      at: 200,
    });
  });

  it("keeps the block when a block and an unblock share a second", () => {
    const merge = mergeMuteList(
      local([alice.pubkey, { blocked: false, at: 100 }]),
      muteList([alice.pubkey], 100, [change(alice.pubkey, true, 100)]),
    );
    expect(merge.blockList).toEqual([alice.pubkey]);
  });
});

describe("block list storage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ now: 1_000_000 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads stored entries as normalized pubkeys, older blocks without a time", () => {
    localStorage.setItem(
      BLOCKED_NOSTR_PUBKEYS_STORAGE_KEY,
      JSON.stringify([alice.pubkey.toUpperCase(), "not-a-pubkey"]),
    );
    expect(readBlockList()).toEqual([alice.pubkey]);
    expect(isBlockedPubkey(alice.pubkey)).toBe(true);
    expect(readBlockChanges().get(alice.pubkey)).toEqual({
      blocked: true,
      at: 0,
    });
  });

  it("blocks and unblocks, recording when", () => {
    blockPubkey(alice.pubkey);
    blockPubkey(alice.pubkey);
    blockPubkey(bob.pubkey);
    expect(readBlockList()).toEqual([alice.pubkey, bob.pubkey]);

    unblockPubkey(alice.pubkey);
    expect(readBlockList()).toEqual([bob.pubkey]);
    expect(readBlockChanges().get(alice.pubkey)).toEqual({
      blocked: false,
      at: 1_001,
      pending: true,
    });
    expect(isBlockedPubkey(carol.pubkey)).toBe(false);
  });

  it("dates a change after the one it replaces when the clock runs behind", () => {
    adoptMuteList(
      muteList([alice.pubkey], 5_000, [change(alice.pubkey, true, 5_000)]),
    );
    unblockPubkey(alice.pubkey);
    expect(readBlockChanges().get(alice.pubkey)).toEqual({
      blocked: false,
      at: 5_001,
      pending: true,
    });
  });

  it("stores what the mute list adds and removes", () => {
    adoptMuteList(
      muteList([alice.pubkey, carol.pubkey], 1_500, [
        change(alice.pubkey, true, 1_000),
        change(carol.pubkey, true, 1_000),
      ]),
    );
    adoptMuteList(
      muteList([bob.pubkey, carol.pubkey], 2_000, [
        change(alice.pubkey, false, 2_000),
        change(bob.pubkey, true, 2_000),
        change(carol.pubkey, true, 1_000),
      ]),
    );
    expect(new Set(readBlockList())).toEqual(
      new Set([bob.pubkey, carol.pubkey]),
    );
  });

  it("keeps a change pending until a merged list holds it", () => {
    blockPubkey(alice.pubkey);
    expect(readBlockChanges().get(alice.pubkey)?.pending).toBe(true);
    adoptMuteList(muteList([], 900));
    expect(readBlockChanges().get(alice.pubkey)?.pending).toBe(true);
    adoptMuteList(
      muteList([alice.pubkey], 1_001, [change(alice.pubkey, true, 1_000)]),
    );
    expect(readBlockChanges().get(alice.pubkey)).toEqual({
      blocked: true,
      at: 1_000,
    });
  });

  it("publishes only changes with a time", () => {
    blockPubkey(alice.pubkey);
    localStorage.setItem(
      BLOCKED_NOSTR_PUBKEYS_STORAGE_KEY,
      JSON.stringify([alice.pubkey, bob.pubkey]),
    );
    expect(toMuteListChanges(readBlockChanges())).toEqual([
      change(alice.pubkey, true, 1_000),
    ]);
  });

  it("tells subscribers when the block list changes, until they unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeBlockList(listener);
    blockPubkey(alice.pubkey);
    expect(listener).toHaveBeenCalledTimes(1);

    adoptMuteList(
      muteList([alice.pubkey], 1_001, [change(alice.pubkey, true, 1_000)]),
    );
    expect(listener).toHaveBeenCalledTimes(1);
    adoptMuteList(
      muteList([bob.pubkey], 1_002, [
        change(alice.pubkey, true, 1_000),
        change(bob.pubkey, true, 1_002),
      ]),
    );
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    unblockPubkey(alice.pubkey);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("tells subscribers when another tab changes the block list, until they unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeBlockList(listener);
    const storageEvent = (key: string) =>
      window.dispatchEvent(new StorageEvent("storage", { key }));

    storageEvent("linky.unrelated");
    expect(listener).not.toHaveBeenCalled();
    storageEvent(BLOCKED_NOSTR_PUBKEYS_STORAGE_KEY);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    storageEvent(BLOCKED_NOSTR_PUBKEYS_STORAGE_KEY);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
