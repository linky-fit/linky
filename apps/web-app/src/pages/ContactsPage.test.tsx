import { derivePubkey, NostrSecretKey } from "@linky-fit/linkstr";
import { createIdFromString } from "@linky-fit/linksync";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NearbyContact } from "../app/lib/beaconStore";
import type { ContactRowLike } from "../app/types/appTypes";
import { navigateTo } from "../hooks/useRouting";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { ContactsPage } from "./ContactsPage";

const beacon = vi.hoisted(() => {
  const state: {
    supported: boolean;
    trade: "none" | "buy" | "sell";
    nearby: NearbyContact[];
    rows: ContactRowLike[];
  } = { supported: false, trade: "none", nearby: [], rows: [] };
  return state;
});

vi.mock("../app/hooks/useBeacon", () => ({
  useBeaconSupport: () => beacon.supported,
  useBeacon: () => ({ trade: beacon.trade }),
  useNearbyContacts: () => beacon.nearby,
}));

vi.mock("../app/hooks/useLinksync", () => ({
  useContactRows: () => beacon.rows,
}));

vi.mock("../app/context/AppShellContexts", () => ({
  useAppShellCore: () => ({
    effectiveProfileName: "Alex Rivers",
    effectiveProfilePicture: null,
    nostrPictureByNpub: {},
  }),
}));

vi.mock("../hooks/useRouting", () => ({ navigateTo: vi.fn() }));

const bea = {
  contactId: createIdFromString<"Contact">("bea"),
  pubkey: derivePubkey(NostrSecretKey.make(new Uint8Array(32).fill(2))),
};

const renderContacts = () =>
  renderIntoDocument(
    <ContactsPage
      activeGroup={null}
      contactsSearch=""
      contactsSearchInputRef={{ current: null }}
      conversationsLabel="Conversations"
      filterOpen={false}
      filterOptions={[]}
      otherContactsLabel="Other contacts"
      renderContactCard={(contact) => (
        <div key={contact.id ?? ""}>{contact.name ?? ""}</div>
      )}
      setActiveGroup={() => undefined}
      setContactsSearch={() => undefined}
      showGroupFilter={false}
      t={(key) => key}
      visibleContacts={{
        conversations: [{ id: bea.contactId, name: "Bea Stone" }],
        others: [],
        pinned: [],
        proxyPayments: [],
      }}
    />,
  );

describe("ContactsPage", () => {
  afterEach(() => {
    beacon.supported = false;
    beacon.trade = "none";
    beacon.nearby = [];
    beacon.rows = [];
    document.body.innerHTML = "";
  });

  it("puts the user with their trade and nearby contacts above the sections", async () => {
    beacon.supported = true;
    beacon.trade = "sell";
    beacon.nearby = [{ ...bea, state: "buy" }];
    beacon.rows = [{ id: bea.contactId, name: "Bea Stone" }];
    const { container, unmount } = await renderContacts();

    expect(
      [...container.querySelectorAll('[role="heading"]')].map(
        (element) => element.textContent,
      ),
    ).toEqual(["nearby", "Conversations"]);
    const avatars = [
      ...container.querySelectorAll<HTMLButtonElement>('[role="group"] button'),
    ];
    expect(
      avatars.map((element) => element.getAttribute("aria-label")),
    ).toEqual(["Alex Rivers, beaconTradeSell", "Bea Stone, beaconTradeBuy"]);
    await act(async () => avatars[1]?.click());
    expect(navigateTo).toHaveBeenCalledWith({
      route: "chat",
      id: bea.contactId,
    });
    await act(async () => avatars[0]?.click());
    expect(navigateTo).toHaveBeenCalledWith({ route: "proxyPayments" });
    await unmount();
  });

  it("hides the nearby section without a trade or nearby contacts", async () => {
    beacon.supported = true;
    const { container, unmount } = await renderContacts();
    expect(container.querySelector('[role="group"]')).toBeNull();
    await unmount();
  });

  it("renders active proxy-payment contacts in their own section", async () => {
    const { container, root } = await renderIntoDocument(
      <ContactsPage
        activeGroup={null}
        contactsSearch=""
        contactsSearchInputRef={{ current: null }}
        conversationsLabel="Conversations"
        filterOpen={false}
        filterOptions={[]}
        otherContactsLabel="Other contacts"
        renderContactCard={(contact) => (
          <div key={contact.id ?? ""} data-contact-id={contact.id ?? ""}>
            {contact.name ?? ""}
          </div>
        )}
        setActiveGroup={() => undefined}
        setContactsSearch={() => undefined}
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
      [...container.querySelectorAll('[role="heading"]')].map(
        (element) => element.textContent,
      ),
    ).toEqual(["Proxy payments", "Conversations", "Other contacts"]);
    expect(
      container.querySelectorAll('[data-contact-id="contact-1"]'),
    ).toHaveLength(1);

    await act(async () => root.unmount());
  });

  it("renders search and group filter only while the filter is open", async () => {
    const renderPage = (filterOpen: boolean) =>
      renderIntoDocument(
        <ContactsPage
          activeGroup={null}
          contactsSearch=""
          contactsSearchInputRef={{ current: null }}
          conversationsLabel="Conversations"
          filterOpen={filterOpen}
          filterOptions={[{ count: 1, label: "Friends", value: "friends" }]}
          otherContactsLabel="Other contacts"
          renderContactCard={(contact) => (
            <div key={contact.id ?? ""}>{contact.name ?? ""}</div>
          )}
          setActiveGroup={() => undefined}
          setContactsSearch={() => undefined}
          showGroupFilter={true}
          t={(key) => key}
          visibleContacts={{
            conversations: [],
            others: [{ id: "contact-1", name: "Alice" }],
            pinned: [],
            proxyPayments: [],
          }}
        />,
      );

    const closed = await renderPage(false);
    expect(closed.container.querySelector("input")).toBeNull();
    expect(closed.container.querySelector('[aria-label="group"]')).toBeNull();
    await act(async () => closed.root.unmount());

    const open = await renderPage(true);
    expect(open.container.querySelector("input")).not.toBeNull();
    expect(open.container.querySelector('[aria-label="group"]')).not.toBeNull();
    await act(async () => open.root.unmount());
  });
});
