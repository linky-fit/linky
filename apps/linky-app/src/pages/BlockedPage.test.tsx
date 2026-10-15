// @vitest-environment jsdom
import {
  encodeNpub,
  EventId,
  FetchedMuteList,
  MuteListChange,
  ProfileMetadata,
  UnixSeconds,
} from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  adoptMuteList,
  blockPubkey,
  readBlockList,
  unblockPubkey,
} from "../app/lib/blockList";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";

const [contact, profiled, stranger] = [
  makeIdentity(),
  makeIdentity(),
  makeIdentity(),
];

const { setPubkeyBlocked } = vi.hoisted(() => ({
  setPubkeyBlocked: vi.fn(),
}));

vi.mock("../app/hooks/shell", async () =>
  (await import("../testUtils/shellHooks")).shellHooksMock(),
);
vi.mock("../app/hooks/contacts/useContactActions", () => ({
  useSetPubkeyBlocked: () => setPubkeyBlocked,
}));
vi.mock("../app/hooks/contacts/useDisplayContacts", () => ({
  useContacts: () => [
    {
      id: "deleted-contact",
      name: "Pepa",
      nameSetByUser: 1,
      npub: encodeNpub(contact.pubkey),
      archivedAtSec: 100,
    },
  ],
}));
vi.mock("@linky-fit/linkstr-react", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@linky-fit/linkstr-react")>();
  const { blockListAtom } = await import("../app/state/contacts/blockList");
  return {
    ...actual,
    useAtomValue: (atom: typeof blockListAtom) =>
      atom === blockListAtom
        ? actual.useAtomValue(atom)
        : {
            metadataByNpub: {
              [encodeNpub(profiled.pubkey)]: new ProfileMetadata({
                displayName: "Karel",
              }),
            },
            pictureByNpub: {},
            statusByNpub: {},
          },
  };
});

import { AtomRegistry, RegistryContext } from "@linky-fit/linkstr-react";
import { BlockedPage } from "./BlockedPage";

// A fresh registry per render: the block list atom outlives a test's localStorage.
const renderPage = () =>
  renderIntoDocument(
    <RegistryContext.Provider value={AtomRegistry.make()}>
      <BlockedPage />
    </RegistryContext.Provider>,
  );

describe("BlockedPage", () => {
  beforeEach(() => {
    localStorage.clear();
    setPubkeyBlocked.mockImplementation(unblockPubkey);
  });

  it("names each block by its contact, profile or npub, and unblocks one", async () => {
    for (const { pubkey } of [contact, profiled, stranger]) blockPubkey(pubkey);
    const { container, unmount } = await renderPage();
    const row = (pubkey: string) =>
      container.querySelector(`[data-testid="blocked-${pubkey}"]`);

    expect(row(contact.pubkey)?.textContent).toContain("Pepa");
    expect(row(profiled.pubkey)?.textContent).toContain("Karel");
    expect(row(stranger.pubkey)?.textContent).toContain(
      encodeNpub(stranger.pubkey).slice(0, 10),
    );

    await act(async () => {
      row(contact.pubkey)?.querySelector("button")?.click();
    });
    expect(setPubkeyBlocked).toHaveBeenCalledWith(contact.pubkey, false);
    expect(row(contact.pubkey)).toBeNull();
    expect(readBlockList()).toEqual([profiled.pubkey, stranger.pubkey]);
    await unmount();
  });

  it("follows blocks made elsewhere in the app and in merged mute lists", async () => {
    const { container, unmount } = await renderPage();
    const row = (pubkey: string) =>
      container.querySelector(`[data-testid="blocked-${pubkey}"]`);
    const merge = (muted: boolean, at: number) =>
      act(async () => {
        adoptMuteList(
          new FetchedMuteList({
            eventId: EventId.make("e".repeat(64)),
            pubkeys: muted ? [stranger.pubkey] : [],
            changes: [
              new MuteListChange({
                pubkey: stranger.pubkey,
                muted,
                at: UnixSeconds.make(at),
              }),
            ],
            createdAt: UnixSeconds.make(at),
          }),
        );
      });

    await act(async () => blockPubkey(profiled.pubkey));
    expect(row(profiled.pubkey)).not.toBeNull();

    await merge(true, 1_000);
    expect(row(stranger.pubkey)).not.toBeNull();
    await merge(false, 1_001);
    expect(row(stranger.pubkey)).toBeNull();
    expect(row(profiled.pubkey)).not.toBeNull();
    await unmount();
  });

  it("says so when nobody is blocked", async () => {
    const { container, unmount } = await renderPage();
    expect(container.textContent).toContain("blockedEmpty");
    await unmount();
  });
});
