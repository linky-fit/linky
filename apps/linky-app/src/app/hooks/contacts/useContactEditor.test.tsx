import { derivePubkey, encodeNpub, NostrSecretKey } from "@linky-fit/linkstr";
import { createId } from "@linky-fit/linksync";
import { Effect, Exit } from "effect";
import React, { act } from "react";
import { expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import { useContactEditor, useContactEditorWatchers } from "./useContactEditor";

const relays = vi.hoisted(() => ({
  fetchProfile: vi.fn(async () => Exit.succeed({ profile: null })),
  searchProfiles: vi.fn(),
}));

vi.mock("@linky-fit/linkstr-react", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@linky-fit/linkstr-react")>();
  return {
    ...actual,
    useLinkstrCommands: () => ({
      fetchProfile: relays.fetchProfile,
      searchProfiles: relays.searchProfiles,
    }),
  };
});
vi.mock("./useContactSuggestions", () => ({
  useContactSuggestions: () => {},
}));
const routing = vi.hoisted(() => ({ navigateTo: vi.fn() }));
vi.mock("../../../hooks/useRouting", () => routing);

type Params = Parameters<typeof useContactEditor>[0];
const contactId = createId<"Contact">();
const otherId = createId<"Contact">();
const initialContact = { id: contactId, name: "Alice" };
const params: Params = {
  contacts: [initialContact],
  contactsRepository: {
    insert: () => Effect.void,
    update: () => Effect.void,
  },
  currentNpub: null,
  restoreContact: vi.fn(async () => ({ ok: true as const })),
  route: { kind: "contactEdit", id: contactId },
  selectedContactMetadata: null,
  selectedContact: initialContact,
  setStatus: vi.fn(),
  t: (key) => key,
};

interface EditorProps {
  selectedContact: Params["selectedContact"];
  route: Params["route"];
}

const Editor = ({ selectedContact, route }: EditorProps) => {
  const editorParams = { ...params, selectedContact, route };
  useContactEditorWatchers(editorParams);
  const { editingId, form, setForm } = useContactEditor(editorParams);
  return (
    <>
      <button onClick={() => setForm({ ...form, name: "Unsaved name" })}>
        Edit name
      </button>
      <output>{editingId}</output>
      <input readOnly value={form.name} />
    </>
  );
};

it("keeps unsaved edits through contact updates, but resets them when changing contacts", async () => {
  const view = await renderIntoDocument(
    <Editor selectedContact={initialContact} route={params.route} />,
  );
  await act(async () => {
    view.container.querySelector("button")?.click();
  });
  expect(view.container.querySelector("output")?.textContent).toBe(contactId);
  await view.rerender(
    <Editor
      selectedContact={{ ...initialContact, name: "Synced name" }}
      route={params.route}
    />,
  );
  expect(view.container.querySelector("output")?.textContent).toBe(contactId);
  expect(view.container.querySelector("input")?.value).toBe("Unsaved name");
  await view.rerender(
    <Editor
      selectedContact={{ id: otherId, name: "Bob" }}
      route={{ kind: "contactEdit", id: otherId }}
    />,
  );
  expect(view.container.querySelector("output")?.textContent).toBe(otherId);
  expect(view.container.querySelector("input")?.value).toBe("Bob");
  await view.unmount();
});

it("looks an npub up by its kind-0 profile only, without a relay text search", async () => {
  const pubkey = derivePubkey(NostrSecretKey.make(new Uint8Array(32).fill(7)));
  const npub = encodeNpub(pubkey);
  const searches: Array<
    ReturnType<typeof useContactEditor>["searchNewContact"]
  > = [];
  const Search = () => {
    const { searchNewContact } = useContactEditor({
      ...params,
      route: { kind: "contactNew" },
    });
    React.useEffect(() => {
      searches.push(searchNewContact);
    }, [searchNewContact]);
    return null;
  };
  const view = await renderIntoDocument(<Search />);

  const result = await searches.at(-1)?.(npub);

  expect(relays.fetchProfile).toHaveBeenCalledWith(pubkey);
  expect(relays.searchProfiles).not.toHaveBeenCalled();
  expect(result).toEqual({
    kind: "found",
    contacts: [expect.objectContaining({ npub, isExactMatch: true })],
  });
  await view.unmount();
});

it("restores a deleted contact instead of adding it again", async () => {
  const pubkey = derivePubkey(NostrSecretKey.make(new Uint8Array(32).fill(8)));
  const npub = encodeNpub(pubkey);
  const deletedId = createId<"Contact">();
  const insert = vi.fn(() => Effect.void);
  const restoreContact = vi.fn(async () => ({ ok: true as const }));
  const adders: Array<
    ReturnType<typeof useContactEditor>["addNewContactFromSearchResult"]
  > = [];
  const Adder = () => {
    const { addNewContactFromSearchResult } = useContactEditor({
      ...params,
      contacts: [{ id: deletedId, npub, archivedAtSec: 10 }],
      contactsRepository: { insert, update: () => Effect.void },
      restoreContact,
      route: { kind: "contactNew" },
    });
    React.useEffect(() => {
      adders.push(addNewContactFromSearchResult);
    }, [addNewContactFromSearchResult]);
    return null;
  };
  const view = await renderIntoDocument(<Adder />);

  await act(async () => {
    await adders.at(-1)?.({
      isExactMatch: true,
      lnAddress: "",
      name: "Alice",
      npub,
      pictureUrl: null,
      query: npub,
    });
  });

  expect(restoreContact).toHaveBeenCalledWith(deletedId);
  expect(insert).not.toHaveBeenCalled();
  expect(routing.navigateTo).toHaveBeenCalledWith({ route: "contacts" });
  await view.unmount();
});
