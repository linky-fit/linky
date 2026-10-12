import {
  EventId,
  FetchedMuteList,
  PlainEventReceipt,
  UnixSeconds,
  type PublishMuteListOptions,
  type Pubkey,
} from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { Exit } from "effect";
import { AtomRegistry } from "effect/reactivity";
import React, { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import {
  blockPubkey,
  hasMergedMuteList,
  readBlockChanges,
  readBlockList,
  recordMuteListMerged,
  toMuteListChanges,
  unblockPubkey,
} from "../../lib/blockList";

const { fetchMock, publishMock } = vi.hoisted(() => ({
  fetchMock: vi.fn<() => Promise<Exit.Exit<FetchedMuteList | null, string>>>(),
  publishMock:
    vi.fn<
      (
        pubkeys: ReadonlyArray<Pubkey>,
        options?: PublishMuteListOptions,
      ) => Promise<Exit.Exit<PlainEventReceipt, string>>
    >(),
}));

vi.mock("@linky-fit/linkstr-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@linky-fit/linkstr-react")>()),
  linkstrCommands: () => ({
    fetchOwnMuteList: fetchMock,
    publishMuteList: publishMock,
  }),
}));

import { RegistryContext } from "@linky-fit/linkstr-react";
import { useMuteListSync } from "./useMuteListSync";

const [me, blockedElsewhere, blockedHere] = [
  makeIdentity(),
  makeIdentity(),
  makeIdentity(),
];

const render = async (enabled: boolean) => {
  const synced: { current: boolean } = { current: false };
  const Probe = ({ on }: { on: boolean }) => {
    const { muteListSynced } = useMuteListSync({
      enabled: on,
      pubkey: me.pubkey,
    });
    React.useEffect(() => {
      synced.current = muteListSynced;
    }, [muteListSynced]);
    return null;
  };
  // A fresh registry per mount: an earlier test's sync must not hold this one's queue.
  const registry = AtomRegistry.make();
  const withRegistry = (on: boolean) => (
    <RegistryContext.Provider value={registry}>
      <Probe on={on} />
    </RegistryContext.Provider>
  );
  const view = await renderIntoDocument(withRegistry(enabled));
  return {
    synced,
    enable: () => view.rerender(withRegistry(true)),
    unmount: () => view.unmount(),
  };
};

const list = (
  pubkeys: ReadonlyArray<Pubkey>,
  createdAt: number,
  changes: FetchedMuteList["changes"] = [],
) =>
  new FetchedMuteList({
    eventId: EventId.make("e".repeat(64)),
    pubkeys,
    changes,
    createdAt: UnixSeconds.make(createdAt),
  });

/** A relay holding one list: a publish replaces it, unless the next `lose` entry, another device's list, wins. */
const relay: { list: FetchedMuteList | null; lose: FetchedMuteList[] } = {
  list: null,
  lose: [],
};

const otherDevicesList = (at: number) =>
  list(
    [blockedElsewhere.pubkey],
    at,
    toMuteListChanges(
      new Map([[blockedElsewhere.pubkey, { blocked: true, at }]]),
    ),
  );

const settle = () =>
  act(async () => {
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
  });

describe("useMuteListSync", () => {
  beforeEach(() => {
    localStorage.clear();
    relay.list = null;
    relay.lose = [];
    fetchMock.mockReset();
    publishMock.mockReset();
    fetchMock.mockImplementation(async () => Exit.succeed(relay.list));
    publishMock.mockImplementation(async (pubkeys, options) => {
      const sentAt = (relay.list?.createdAt ?? 1_000) + 1;
      relay.list =
        relay.lose.shift() ?? list(pubkeys, sentAt, options?.changes ?? []);
      return Exit.succeed(
        new PlainEventReceipt({
          eventId: EventId.make("f".repeat(64)),
          kind: 10000,
          sentAt: UnixSeconds.make(sentAt),
          results: [],
        }),
      );
    });
  });

  it("merges the newest list once Nostr may start, then reports synced", async () => {
    blockPubkey(blockedHere.pubkey);
    relay.list = list([blockedElsewhere.pubkey], 1_000);
    const probe = await render(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(probe.synced.current).toBe(false);

    await act(async () => {
      await probe.enable();
    });
    await settle();

    expect(probe.synced.current).toBe(true);
    expect(new Set(readBlockList())).toEqual(
      new Set([blockedElsewhere.pubkey, blockedHere.pubkey]),
    );
    expect(publishMock).toHaveBeenCalledTimes(1);
    expect(publishMock).toHaveBeenCalledWith(
      expect.arrayContaining([blockedElsewhere.pubkey, blockedHere.pubkey]),
      {
        changes: expect.arrayContaining([
          expect.objectContaining({ pubkey: blockedHere.pubkey }),
        ]),
        replaces: 1_000,
      },
    );
    expect(hasMergedMuteList(me.pubkey)).toBe(true);
    expect(readBlockChanges().get(blockedHere.pubkey)?.pending).toBeUndefined();
    await probe.unmount();
  });

  it("publishes an unblock over the list that still holds the block", async () => {
    blockPubkey(blockedElsewhere.pubkey);
    blockPubkey(blockedHere.pubkey);
    relay.list = list(
      [blockedElsewhere.pubkey, blockedHere.pubkey],
      1_000,
      toMuteListChanges(readBlockChanges()),
    );
    unblockPubkey(blockedHere.pubkey);
    const probe = await render(true);
    await settle();

    expect(readBlockList()).toEqual([blockedElsewhere.pubkey]);
    expect(relay.list?.pubkeys).toEqual([blockedElsewhere.pubkey]);
    expect(relay.list?.changes).toContainEqual(
      expect.objectContaining({ pubkey: blockedHere.pubkey, muted: false }),
    );
    await probe.unmount();
  });

  it("publishes again when another device's concurrent list replaced its own", async () => {
    blockPubkey(blockedHere.pubkey);
    relay.list = list([], 1_000);
    relay.lose = [otherDevicesList(1_001)];
    const probe = await render(true);
    await settle();

    expect(publishMock).toHaveBeenCalledTimes(2);
    expect(new Set(relay.list?.pubkeys)).toEqual(
      new Set([blockedElsewhere.pubkey, blockedHere.pubkey]),
    );
    await probe.unmount();
  });

  it("settles its changes with a last fetch after the last publish it may make", async () => {
    blockPubkey(blockedHere.pubkey);
    relay.list = list([], 1_000);
    relay.lose = [otherDevicesList(1_001), otherDevicesList(1_002)];
    const probe = await render(true);
    await settle();

    expect(publishMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(readBlockChanges().get(blockedHere.pubkey)?.pending).toBeUndefined();
    await probe.unmount();
  });

  it("does not hold the inbox once this device has merged the identity's list", async () => {
    recordMuteListMerged(me.pubkey);
    fetchMock.mockReturnValue(new Promise(() => {}));
    const probe = await render(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(probe.synced.current).toBe(true);
    await probe.unmount();
  });

  it("reports synced when the fetch fails or cannot tell whether a list exists, leaving the local list alone", async () => {
    blockPubkey(blockedHere.pubkey);
    fetchMock.mockResolvedValue(Exit.fail("SomeRelaysUnanswered"));
    const probe = await render(true);
    await settle();

    expect(probe.synced.current).toBe(true);
    expect(readBlockList()).toEqual([blockedHere.pubkey]);
    expect(publishMock).not.toHaveBeenCalled();
    expect(hasMergedMuteList(me.pubkey)).toBe(false);
    await probe.unmount();
  });
});
