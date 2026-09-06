import {
  decodeNpub,
  ProfileMetadata,
  ProfileUpdated,
  UnixSeconds,
} from "@linky/linkstr";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveCachedProfile } from "../../profileCache";
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

const makeCtx = (contacts: SyncContext["contacts"], routeKind = "contacts") => {
  const update = vi.fn<SyncContext["update"]>(() => ({
    ok: true,
    value: undefined,
  }));
  const ctx: SyncContext = {
    contacts,
    contactsOwnerId: null,
    contactsVisibleOwnerIds: [],
    routeKind,
    setNostrMetadataByNpub: vi.fn(),
    setNostrPictureByNpub: vi.fn(),
    setNostrStatusByNpub: vi.fn(),
    update,
  };
  const contactPatches = () =>
    update.mock.calls
      .filter(([table]) => table === "contact")
      .map(([, payload]) => payload);
  return { contactPatches, ctx };
};

describe("applyProfileWatchEvent contact-row policy", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("fills non-overridden fields from the profile", () => {
    const { contactPatches, ctx } = makeCtx([{ id: "c1", npub: NPUB }]);
    applyProfileWatchEvent(
      profileUpdated({ lud16: "vitor@ln.example", name: "Vitor" }, 100),
      ctx,
    );
    expect(contactPatches()).toEqual([
      { id: "c1", lnAddress: "vitor@ln.example", name: "Vitor" },
    ]);
  });

  it("leaves user-overridden fields alone", () => {
    const { contactPatches, ctx } = makeCtx([
      {
        id: "c1",
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
      { id: "c1", lnAddress: "manual@ln.example", name: "Vitor", npub: NPUB },
    ]);
    // Previous profile had a name but no lightning address.
    saveCachedProfile(NPUB, metadata({ name: "Vitor" }), 50);
    applyProfileWatchEvent(profileUpdated({ name: "Vitor" }, 100), ctx);
    expect(contactPatches()).toEqual([]);
  });

  it("clears a field the profile itself dropped", () => {
    const { contactPatches, ctx } = makeCtx([
      { id: "c1", lnAddress: "vitor@ln.example", name: "Vitor", npub: NPUB },
    ]);
    saveCachedProfile(
      NPUB,
      metadata({ lud16: "vitor@ln.example", name: "Vitor" }),
      50,
    );
    applyProfileWatchEvent(profileUpdated({ name: "Vitor" }, 100), ctx);
    expect(contactPatches()).toEqual([{ id: "c1", lnAddress: null }]);
  });

  it("does not touch rows while a contact form route is open", () => {
    const { contactPatches, ctx } = makeCtx(
      [{ id: "c1", npub: NPUB }],
      "contactEdit",
    );
    applyProfileWatchEvent(
      profileUpdated({ lud16: "vitor@ln.example", name: "Vitor" }, 100),
      ctx,
    );
    expect(contactPatches()).toEqual([]);
  });
});
