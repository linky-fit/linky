// @vitest-environment jsdom
import { encodeNpub, ProfileMetadata } from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
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
vi.mock("@linky-fit/linkstr-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@linky-fit/linkstr-react")>()),
  useAtomValue: () => ({
    metadataByNpub: {
      [encodeNpub(profiled.pubkey)]: new ProfileMetadata({
        displayName: "Karel",
      }),
    },
    pictureByNpub: {},
    statusByNpub: {},
  }),
}));

import { BlockedPage } from "./BlockedPage";

describe("BlockedPage", () => {
  beforeEach(() => {
    localStorage.clear();
    setPubkeyBlocked.mockImplementation(unblockPubkey);
  });

  it("names each block by its contact, profile or npub, and unblocks one", async () => {
    for (const { pubkey } of [contact, profiled, stranger]) blockPubkey(pubkey);
    const { container, unmount } = await renderIntoDocument(<BlockedPage />);
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

  it("says so when nobody is blocked", async () => {
    const { container, unmount } = await renderIntoDocument(<BlockedPage />);
    expect(container.textContent).toContain("blockedEmpty");
    await unmount();
  });
});
