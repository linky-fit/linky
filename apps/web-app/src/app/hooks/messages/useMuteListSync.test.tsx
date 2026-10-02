import {
  EventId,
  FetchedMuteList,
  UnixSeconds,
  type Pubkey,
} from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { Exit } from "effect";
import React, { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import {
  blockPubkey,
  hasMergedMuteList,
  readBlockList,
  recordMuteListMerged,
} from "../../lib/blockList";

const { fetchMock, publishMock } = vi.hoisted(() => ({
  fetchMock: vi.fn<() => Promise<Exit.Exit<FetchedMuteList | null, string>>>(),
  publishMock:
    vi.fn<(pubkeys: ReadonlyArray<Pubkey>) => Promise<Exit.Exit<void>>>(),
}));

vi.mock("@linky-fit/linkstr-react", () => ({
  fetchOwnMuteListAtom: "fetch",
  publishMuteListAtom: "publish",
  useAtomSet: (atom: string) => (atom === "fetch" ? fetchMock : publishMock),
}));

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
  const view = await renderIntoDocument(<Probe on={enabled} />);
  return {
    synced,
    enable: () => view.rerender(<Probe on />),
    unmount: () => view.unmount(),
  };
};

describe("useMuteListSync", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockReset();
    publishMock.mockReset();
    publishMock.mockResolvedValue(Exit.void);
  });

  it("merges the newest list once Nostr may start, then reports synced", async () => {
    blockPubkey(blockedHere.pubkey);
    fetchMock.mockResolvedValue(
      Exit.succeed(
        new FetchedMuteList({
          eventId: EventId.make("e".repeat(64)),
          pubkeys: [blockedElsewhere.pubkey],
          createdAt: UnixSeconds.make(1_000),
        }),
      ),
    );
    const probe = await render(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(probe.synced.current).toBe(false);

    await act(async () => {
      await probe.enable();
    });

    expect(probe.synced.current).toBe(true);
    expect(new Set(readBlockList())).toEqual(
      new Set([blockedElsewhere.pubkey, blockedHere.pubkey]),
    );
    expect(publishMock).toHaveBeenCalledTimes(1);
    expect(hasMergedMuteList(me.pubkey)).toBe(true);
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
    await act(async () => {
      await Promise.resolve();
    });

    expect(probe.synced.current).toBe(true);
    expect(readBlockList()).toEqual([blockedHere.pubkey]);
    expect(publishMock).not.toHaveBeenCalled();
    expect(hasMergedMuteList(me.pubkey)).toBe(false);
    await probe.unmount();
  });
});
