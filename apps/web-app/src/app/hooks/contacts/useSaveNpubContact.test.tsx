import { encodeNpub } from "@linky/linkstr";
import { makeIdentity } from "@linky/linkstr/testing";
import { ShardDbError, type ContactsRepository } from "@linky/linksync";
import { Effect } from "effect";
import { act, useLayoutEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import { useSaveNpubContact } from "./useSaveNpubContact";

vi.mock("../../../devtools/inspector/appLog", () => ({
  reportAppLog: vi.fn(),
}));
type Params = Parameters<typeof useSaveNpubContact>[0];
const npub = encodeNpub(makeIdentity().pubkey);
const makeParams = (insert: ContactsRepository["insert"]): Params => ({
  contacts: [],
  contactsRepository: { insert },
  buildSavedContactName: (name, npub) => name || npub,
  unknownNameByNpub: {},
  lang: "en",
  setStatus: vi.fn(),
  t: (key) => key,
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
  it("answers with the new id at once and deduplicates until the row is read back", async () => {
    const insert = vi.fn<ContactsRepository["insert"]>(() => Effect.void);
    const view = await mountSaver(makeParams(insert));
    await act(async () => {
      const first = view.save(npub);
      expect(first).toMatchObject({ created: true, contact: { npub } });
      expect(view.save(npub)).toMatchObject({
        created: false,
        contact: { id: first?.contact.id },
      });
    });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0]?.[0]).toMatchObject({
      name: expect.stringMatching(/\S/),
      npub,
    });
    await view.unmount();
  });
  it("reports a failed insert and lets the npub be saved again", async () => {
    const insert = vi
      .fn<ContactsRepository["insert"]>()
      .mockReturnValueOnce(
        Effect.fail(
          new ShardDbError({ table: "contact", message: "scope unavailable" }),
        ),
      )
      .mockReturnValue(Effect.void);
    const params = makeParams(insert);
    const view = await mountSaver(params);
    await act(async () => {
      expect(view.save(npub)?.created).toBe(true);
    });
    expect(params.setStatus).toHaveBeenCalledWith(
      expect.stringContaining("scope unavailable"),
    );
    await act(async () => {
      expect(view.save(npub)?.created).toBe(true);
    });
    expect(insert).toHaveBeenCalledTimes(2);
    await view.unmount();
  });
});
