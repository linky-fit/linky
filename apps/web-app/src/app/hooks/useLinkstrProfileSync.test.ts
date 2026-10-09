import {
  decodeNpub,
  ProfileMetadata,
  ProfileUpdated,
  UnixSeconds,
} from "@linky-fit/linkstr";
import {
  createIdFromString,
  type ContactsRepository,
} from "@linky-fit/linksync";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadCachedProfile, saveCachedProfile } from "../../profileCache";
import { applyProfileWatchEvent } from "./useLinkstrProfileSync";

const NPUB = "npub1gcxzte5zlkncx26j68ez60fzkvtkm9e0vrwdcvsjakxf9mu9qewqlfnj5z";

const metadata = (fields: { lud16?: string; name?: string }): ProfileMetadata =>
  new ProfileMetadata(fields);

const profileUpdated = (
  fields: { lud16?: string; name?: string },
  updatedAt: number,
): ProfileUpdated => {
  const pubkey = decodeNpub(NPUB);
  if (!pubkey) throw new Error("test npub must decode");
  return new ProfileUpdated({
    metadata: metadata(fields),
    pubkey,
    updatedAt: UnixSeconds.make(updatedAt),
  });
};

type SyncContext = Parameters<typeof applyProfileWatchEvent>[1];

const c1 = createIdFromString<"Contact">("c1");

const makeCtx = (contacts: SyncContext["contacts"], routeKind = "contacts") => {
  const update = vi.fn<ContactsRepository["update"]>(() => Effect.void);
  const ctx: SyncContext = {
    contacts,
    contactsRepository: { update },
    routeKind,
    setNostrMetadataByNpub: vi.fn(),
    setNostrPictureByNpub: vi.fn(),
    setNostrStatusByNpub: vi.fn(),
  };
  const contactPatches = () =>
    update.mock.calls.map(([id, patch]) => ({ id, ...patch }));
  return { contactPatches, ctx };
};

describe("applyProfileWatchEvent contact-row policy", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("normalizes an incoming profile name before syncing it", () => {
    const { contactPatches, ctx } = makeCtx([{ id: c1, npub: NPUB }]);
    applyProfileWatchEvent(
      profileUpdated({ name: "  Ali\u202ece\u200b\n Admin  " }, 100),
      ctx,
    );
    expect(contactPatches()).toEqual([{ id: c1, name: "Alice Admin" }]);
  });

  it("does not let a hostile profile rename a saved custom contact", () => {
    const { contactPatches, ctx } = makeCtx([
      { id: c1, npub: NPUB, name: "My friend", nameSetByUser: 1 },
    ]);
    applyProfileWatchEvent(
      profileUpdated({ name: "Bank\u202e support" }, 100),
      ctx,
    );
    expect(contactPatches()).toEqual([]);
  });

  it("fills non-overridden fields from the profile", () => {
    const { contactPatches, ctx } = makeCtx([{ id: c1, npub: NPUB }]);
    applyProfileWatchEvent(
      profileUpdated({ lud16: "vitor@ln.example", name: "Vitor" }, 100),
      ctx,
    );
    expect(contactPatches()).toEqual([
      { id: c1, lnAddress: "vitor@ln.example", name: "Vitor" },
    ]);
  });

  it("leaves user-overridden fields alone", () => {
    const { contactPatches, ctx } = makeCtx([
      {
        id: c1,
        lnAddress: "custom@ln.example",
        lnAddressSetByUser: 1,
        name: "Moje jméno",
        nameSetByUser: 1,
        npub: NPUB,
      },
    ]);
    applyProfileWatchEvent(
      profileUpdated({ lud16: "vitor@ln.example", name: "Vitor" }, 100),
      ctx,
    );
    expect(contactPatches()).toEqual([]);
  });

  it("never clears a value the profile did not previously provide", () => {
    const { contactPatches, ctx } = makeCtx([
      { id: c1, lnAddress: "manual@ln.example", name: "Vitor", npub: NPUB },
    ]);
    // Previous profile had a name but no lightning address.
    saveCachedProfile(NPUB, metadata({ name: "Vitor" }), 50);
    applyProfileWatchEvent(profileUpdated({ name: "Vitor" }, 100), ctx);
    expect(contactPatches()).toEqual([]);
  });

  it("clears a field the profile itself dropped", () => {
    const { contactPatches, ctx } = makeCtx([
      { id: c1, lnAddress: "vitor@ln.example", name: "Vitor", npub: NPUB },
    ]);
    saveCachedProfile(
      NPUB,
      metadata({ lud16: "vitor@ln.example", name: "Vitor" }),
      50,
    );
    applyProfileWatchEvent(profileUpdated({ name: "Vitor" }, 100), ctx);
    expect(contactPatches()).toEqual([{ id: c1, lnAddress: null }]);
  });

  it("does not touch rows while a contact form route is open", () => {
    const { contactPatches, ctx } = makeCtx(
      [{ id: c1, npub: NPUB }],
      "contactEdit",
    );
    applyProfileWatchEvent(
      profileUpdated({ lud16: "vitor@ln.example", name: "Vitor" }, 100),
      ctx,
    );
    expect(contactPatches()).toEqual([]);
  });

  it("fills a new row from the cache when the watch repeats a cached fact", () => {
    saveCachedProfile(
      NPUB,
      metadata({ lud16: "vitor@ln.example", name: "Vitor" }),
      100,
    );
    const { contactPatches, ctx } = makeCtx([{ id: c1, npub: NPUB }]);
    applyProfileWatchEvent(
      profileUpdated({ lud16: "vitor@ln.example", name: "Vitor" }, 100),
      ctx,
    );
    expect(contactPatches()).toEqual([
      { id: c1, lnAddress: "vitor@ln.example", name: "Vitor" },
    ]);
  });

  it("refreshes a cache that decoded the same event without its extra fields", () => {
    const pubkey = decodeNpub(NPUB);
    if (!pubkey) throw new Error("test npub must decode");
    const withExtras = new ProfileMetadata({
      name: "Vitor",
      extraFields: { website: "https://vitor.example" },
    });
    const fact = new ProfileUpdated({
      metadata: withExtras,
      pubkey,
      updatedAt: UnixSeconds.make(100),
    });
    saveCachedProfile(NPUB, metadata({ name: "Vitor" }), 100);

    const first = makeCtx([]);
    applyProfileWatchEvent(fact, first.ctx);
    expect(first.ctx.setNostrMetadataByNpub).toHaveBeenCalledTimes(1);
    expect(loadCachedProfile(NPUB)?.metadata).toEqual(withExtras);

    const repeat = makeCtx([]);
    applyProfileWatchEvent(fact, repeat.ctx);
    expect(repeat.ctx.setNostrMetadataByNpub).not.toHaveBeenCalled();
  });
});
