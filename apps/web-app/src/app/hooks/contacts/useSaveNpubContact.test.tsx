import * as Evolu from "@evolu/common";
import { encodeNpub } from "@linky/linkstr";
import { makeIdentity } from "@linky/linkstr/testing";
import { act, useLayoutEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import { MAX_CONTACTS_PER_OWNER } from "../../../utils/constants";
import { useSaveNpubContact } from "./useSaveNpubContact";

vi.mock("../../../devtools/inspector/appLog", () => ({
  reportAppLog: vi.fn(),
}));
type Params = Parameters<typeof useSaveNpubContact>[0];
const owner = Evolu.createAppOwner(
  Evolu.OwnerSecret.orThrow(new Uint8Array(32).fill(3)),
).id;
const npub = encodeNpub(makeIdentity().pubkey);
const otherNpub = encodeNpub(makeIdentity().pubkey);
const contactId = Evolu.createIdFromString<"Contact">("contact");
const makeParams = (): Params => ({
  contacts: [],
  contactsOwnerId: owner,
  activeContactsOwnerContactCount: 0,
  buildSavedContactName: (name, npub) => name || npub,
  unknownNameByNpub: {},
  lang: "en",
  setStatus: vi.fn(),
  t: (key) => key,
  insert: vi
    .fn<Params["insert"]>()
    .mockReturnValue({ ok: true, value: { id: contactId } }),
});
const mountSaver = async (params: Params) => {
  let save: ReturnType<typeof useSaveNpubContact> | undefined;
  const Probe = () => {
    const callback = useSaveNpubContact(params);
    useLayoutEffect(() => {
      save = callback;
    }, [callback]);
    return null;
  };
  const view = await renderIntoDocument(<Probe />);
  return {
    ...view,
    save: (npub: string) => {
      if (!save) throw new Error("Not mounted");
      return save(npub);
    },
  };
};

describe("saving npub contacts", () => {
  it("deduplicates pending inserts before Evolu publishes the row and writes a name", async () => {
    const params = makeParams();
    const view = await mountSaver(params);
    await act(async () => {
      expect(view.save(npub)).toMatchObject({
        created: true,
        contact: { id: contactId, npub },
      });
      expect(view.save(npub)).toMatchObject({
        created: false,
        contact: { id: contactId },
      });
    });
    expect(params.insert).toHaveBeenCalledTimes(1);
    expect(params.insert).toHaveBeenCalledWith(
      "contact",
      { name: expect.stringMatching(/\S/), npub },
      { ownerId: owner },
    );
    await view.unmount();
  });
  it("counts pending inserts toward the owner contact limit", async () => {
    const params = {
      ...makeParams(),
      activeContactsOwnerContactCount: MAX_CONTACTS_PER_OWNER - 1,
    };
    const view = await mountSaver(params);
    await act(async () => {
      expect(view.save(npub)).not.toBeNull();
      expect(view.save(otherNpub)).toBeNull();
    });
    expect(params.insert).toHaveBeenCalledTimes(1);
    expect(params.setStatus).toHaveBeenCalledWith("contactsLimitReached");
    await view.unmount();
  });
  it("returns the actual fallback owner for subsequent group updates", async () => {
    const params = makeParams();
    params.insert = vi
      .fn<Params["insert"]>()
      .mockReturnValueOnce({ ok: false, error: "scope unavailable" })
      .mockReturnValue({ ok: true, value: { id: contactId } });
    const view = await mountSaver(params);
    await act(async () => {
      expect(view.save(npub)).toMatchObject({
        ownerId: null,
        contact: { ownerId: null },
      });
    });
    expect(params.insert).toHaveBeenCalledTimes(2);
    expect(params.insert).toHaveBeenLastCalledWith("contact", {
      name: expect.stringMatching(/\S/),
      npub,
    });
    await view.unmount();
  });
});
