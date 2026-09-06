import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { ContactsPage } from "./ContactsPage";

describe("ContactsPage", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders active proxy-payment contacts in their own section", async () => {
    const { container, root } = await renderIntoDocument(
      <ContactsPage
        activeGroup={null}
        bottomTabActive="contacts"
        contactsSearch=""
        contactsSearchInputRef={{ current: null }}
        conversationsLabel="Conversations"
        filterOptions={[]}
        openNewContactPage={() => undefined}
        otherContactsLabel="Other contacts"
        renderContactCard={(contact) => (
          <div key={contact.id ?? ""} data-contact-id={contact.id ?? ""}>
            {contact.name ?? ""}
          </div>
        )}
        setActiveGroup={() => undefined}
        setContactsSearch={() => undefined}
        showBottomTabBar={false}
        showFab={false}
        showGroupFilter={false}
        t={(key) => (key === "proxyPayments" ? "Proxy payments" : key)}
        visibleContacts={{
          conversations: [{ id: "contact-2", name: "Bob" }],
          others: [{ id: "contact-3", name: "Carol" }],
          pinned: [],
          proxyPayments: [{ id: "contact-1", name: "Alice" }],
        }}
      />,
    );

    expect(
      [...container.querySelectorAll(".contact-list-section-title")].map(
        (element) => element.textContent,
      ),
    ).toEqual(["Proxy payments", "Conversations", "Other contacts"]);
    expect(
      container.querySelectorAll('[data-contact-id="contact-1"]'),
    ).toHaveLength(1);

    await act(async () => root.unmount());
  });
});
