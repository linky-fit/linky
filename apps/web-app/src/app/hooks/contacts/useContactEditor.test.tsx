import { createId } from "@linky/linksync";
import { Effect } from "effect";
import { act } from "react";
import { expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import { useContactEditor } from "./useContactEditor";

vi.mock("@linky/linkstr-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@linky/linkstr-react")>()),
  useAtomSet: () => vi.fn(),
}));
vi.mock("./useContactSuggestions", () => ({
  useContactSuggestions: () => [],
}));

type Params = Parameters<typeof useContactEditor>[0];
const contactId = createId<"Contact">();
const otherId = createId<"Contact">();
const initialContact = { id: contactId, name: "Alice" };
const params: Params = {
  contactNewPrefill: null,
  contacts: [initialContact],
  contactsRepository: {
    insert: () => Effect.void,
    update: () => Effect.void,
  },
  currentNpub: null,
  route: { kind: "contactEdit", id: contactId },
  selectedContactMetadata: null,
  selectedContact: initialContact,
  setContactNewPrefill: vi.fn(),
  setRecentlyAddedContactId: vi.fn(),
  setStatus: vi.fn(),
  t: (key) => key,
  transactions: { all: Effect.succeed([]), update: () => Effect.void },
};

interface EditorProps {
  selectedContact: Params["selectedContact"];
  route: Params["route"];
}

const Editor = ({ selectedContact, route }: EditorProps) => {
  const { editingId, form, setForm } = useContactEditor({
    ...params,
    selectedContact,
    route,
  });
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
