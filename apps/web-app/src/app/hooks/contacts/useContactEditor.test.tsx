import { createId } from "@linky/linksync";
import { Effect } from "effect";
import { act, useState } from "react";
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
  setPendingDeleteId: vi.fn(),
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
  const [pendingDeleteId, setPendingDeleteId] = useState<
    typeof contactId | null
  >(null);
  const { editingId, form, setForm } = useContactEditor({
    ...params,
    selectedContact,
    route,
    setPendingDeleteId,
  });
  return (
    <>
      <button onClick={() => setPendingDeleteId(editingId)}>Arm archive</button>
      <button onClick={() => setForm({ ...form, name: "Unsaved name" })}>
        Edit name
      </button>
      <output>{pendingDeleteId}</output>
      <input readOnly value={form.name} />
    </>
  );
};

it("keeps archive confirmation and unsaved edits through contact updates, but resets them when changing contacts", async () => {
  const view = await renderIntoDocument(
    <Editor selectedContact={initialContact} route={params.route} />,
  );
  const buttons = view.container.querySelectorAll("button");
  await act(async () => {
    buttons[0]?.click();
    buttons[1]?.click();
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
  expect(view.container.querySelector("output")?.textContent).toBe("");
  expect(view.container.querySelector("input")?.value).toBe("Bob");
  await view.unmount();
});
