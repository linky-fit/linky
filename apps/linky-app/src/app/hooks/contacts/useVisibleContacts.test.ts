import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { useVisibleContacts } from "./useVisibleContacts";

it("orders contacts by their Evolu ISO creation date and leaves undated contacts last", () => {
  const contacts = [
    { id: "older", name: "Alice", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "undated", name: "Aaron", createdAt: null },
    { id: "newer", name: "Zoe", createdAt: "2026-02-01T00:00:00.000Z" },
  ];
  function ContactOrder() {
    const visible = useVisibleContacts({
      activeGroup: null,
      contactNameCollator: new Intl.Collator("en"),
      contactsSearchData: contacts.map((contact) => ({
        contact,
        haystack: contact.name,
        idKey: contact.id,
      })),
      contactsSearchParts: [],
      lastMessageByContactId: new Map(),
      noGroupFilterValue: "no-group",
      pinnedContactId: null,
      unreadByContactId: new Map(),
    });
    return visible.others.map((contact) => contact.id).join(",");
  }
  expect(renderToStaticMarkup(createElement(ContactOrder))).toBe(
    "newer,older,undated",
  );
});
