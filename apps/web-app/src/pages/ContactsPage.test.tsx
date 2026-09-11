import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { encodeNpub } from "@linky/linkstr";
import { makeIdentity } from "@linky/linkstr/testing";
import { BluetoothContext } from "../bluetooth/BluetoothContext";
import { emptyBluetoothSnapshot } from "../bluetooth/controller";
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

  it("moves nearby saved friends across sections once and restores order when inactive", async () => {
    const alice = makeIdentity();
    const bob = makeIdentity();
    const aliceNpub = encodeNpub(alice.pubkey);
    const bobNpub = encodeNpub(bob.pubkey);
    const page = (active: boolean, available = true) => (
      <BluetoothContext.Provider
        value={{
          ...emptyBluetoothSnapshot,
          available,
          enabled: true,
          state: {
            supported: true,
            powered: true,
            permission: "granted",
            active,
          },
          nearby: [
            {
              pubkey: alice.pubkey,
              npub: aliceNpub,
              meshId: "alice",
            },
            { pubkey: bob.pubkey, npub: bobNpub, meshId: "bob" },
          ],
          nearbyCount: 3,
          setEnabled: async () => {},
          sendMessage: async () => {},
        }}
      >
        <ContactsPage
          activeGroup={null}
          bottomTabActive="contacts"
          contactsSearch=""
          contactsSearchInputRef={{ current: null }}
          conversationsLabel="Conversations"
          filterOptions={[]}
          openNewContactPage={() => {}}
          otherContactsLabel="Other contacts"
          renderContactCard={(contact) => (
            <div key={contact.id ?? ""} data-contact-id={contact.id ?? ""}>
              {contact.name}
            </div>
          )}
          setActiveGroup={() => {}}
          setContactsSearch={() => {}}
          showBottomTabBar={false}
          showFab={false}
          showGroupFilter={false}
          t={(key) =>
            key === "bluetoothNearbyCount" ? "Nearby peers: {count}" : key
          }
          visibleContacts={{
            pinned: [{ id: "pinned", name: "Pinned" }],
            proxyPayments: [{ id: "alice", name: "Alice", npub: aliceNpub }],
            conversations: [
              {
                id: "unknown",
                name: "Unknown",
                npub: bobNpub,
                isUnknownContact: true,
              },
              { id: "alice", name: "Alice", npub: aliceNpub },
            ],
            others: [{ id: "bob", name: "Bob", npub: bobNpub }],
          }}
        />
      </BluetoothContext.Provider>
    );
    const rendered = await renderIntoDocument(page(true));
    const order = () =>
      [...rendered.container.querySelectorAll("[data-contact-id]")].map(
        (element) => element.getAttribute("data-contact-id"),
      );
    expect(order()).toEqual(["alice", "bob", "pinned", "unknown"]);
    expect(
      rendered.container.querySelector(".contact-list-section-title")
        ?.textContent,
    ).toBe("bluetoothNearby");
    expect(
      rendered.container.querySelector(".bluetooth-room-entry"),
    ).toBeNull();

    await rendered.rerender(page(false));
    expect(order()).toEqual(["pinned", "alice", "unknown", "bob"]);
    expect(rendered.container.textContent).not.toContain("bluetoothNearby");
    expect(
      rendered.container.querySelector(".bluetooth-room-entry"),
    ).toBeNull();

    await rendered.rerender(page(true, false));
    expect(order()).toEqual(["pinned", "alice", "unknown", "bob"]);
    expect(
      rendered.container.querySelector(".bluetooth-room-entry"),
    ).toBeNull();
    await rendered.unmount();
  });
});
