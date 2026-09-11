import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeNpub } from "@linky/linkstr";
import { makeIdentity } from "@linky/linkstr/testing";
import { BluetoothContext } from "../bluetooth/BluetoothContext";
import { emptyBluetoothSnapshot } from "../bluetooth/controller";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { ContactNewPage, type ContactSearchResult } from "./ContactNewPage";

describe("ContactNewPage", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("opens contact details when a lightning address is prefilled", async () => {
    const { container, root } = await renderIntoDocument(
      <ContactNewPage
        addNewContactFromSearchResult={async () => {}}
        contactSuggestions={[]}
        form={{
          groups: [],
          lnAddress: "alice@example.com",
          name: "",
          npub: "",
        }}
        groupNames={[]}
        handleSaveContact={() => {}}
        isSavingContact={false}
        searchNewContact={async () => ({ kind: "empty" })}
        setForm={() => {}}
        t={(key) => key}
      />,
    );

    const inputs = container.querySelectorAll("input");
    expect(inputs).toHaveLength(3);
    expect(inputs[1]?.value).toBe("alice@example.com");

    await act(async () => root.unmount());
  });

  it("lists search candidates and highlights the verified exact match", async () => {
    vi.useFakeTimers();
    const exact = {
      isExactMatch: true,
      lnAddress: "alice@linky.fit",
      name: "Alice",
      npub: "npub1alice",
      pictureUrl: null,
      query: "alice",
    };
    const similar = {
      isExactMatch: false,
      lnAddress: "",
      name: "Alice Cooper",
      npub: "npub1cooper",
      pictureUrl: null,
      query: "alice",
    };

    const { container, root } = await renderIntoDocument(
      <ContactNewPage
        addNewContactFromSearchResult={async () => {}}
        contactSuggestions={[]}
        form={{ groups: [], lnAddress: "", name: "", npub: "alice" }}
        groupNames={[]}
        handleSaveContact={() => {}}
        isSavingContact={false}
        searchNewContact={async () => ({
          contacts: [exact, similar],
          kind: "found",
        })}
        setForm={() => {}}
        t={(key) => key}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });

    const rows = container.querySelectorAll(".contact-new-search-result");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.classList.contains("is-exact")).toBe(true);
    expect(rows[0]?.textContent).toContain("Alice");
    expect(rows[1]?.classList.contains("is-exact")).toBe(false);
    expect(rows[1]?.textContent).toContain("Alice Cooper");

    await act(async () => root.unmount());
  });

  it("adds a nearby identity offline while excluding self and known contacts", async () => {
    const identities = [makeIdentity(), makeIdentity(), makeIdentity()];
    const peers = identities.map((identity, index) => ({
      pubkey: identity.pubkey,
      npub: encodeNpub(identity.pubkey),
      name: `Nearby ${index}`,
      meshId: String(index),
    }));
    const newcomer = peers[2];
    if (!newcomer) throw new Error("Missing nearby fixture");
    const add = vi.fn(async () => {});
    const search = vi.fn(
      async (): Promise<ContactSearchResult> => ({ kind: "empty" }),
    );
    const page = (active: boolean) => (
      <BluetoothContext.Provider
        value={{
          ...emptyBluetoothSnapshot,
          available: true,
          enabled: true,
          state: {
            supported: true,
            powered: true,
            permission: "granted",
            active,
          },
          nearby: [...peers, newcomer],
          nearbyCount: 3,
          setEnabled: async () => {},
          sendMessage: async () => {},
        }}
      >
        <ContactNewPage
          addNewContactFromSearchResult={add}
          contactSuggestions={[]}
          form={{ groups: [], lnAddress: "", name: "", npub: "" }}
          groupNames={[]}
          handleSaveContact={() => {}}
          isSavingContact={false}
          knownNpubs={peers.slice(0, 2).map((peer) => peer.npub)}
          searchNewContact={search}
          setForm={() => {}}
          t={(key) => key}
        />
      </BluetoothContext.Provider>
    );
    const rendered = await renderIntoDocument(page(true));
    const rows = rendered.container.querySelectorAll(
      ".bluetooth-nearby-users .contact-new-suggestion",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain(newcomer.name);
    await act(async () => rows[0]?.querySelector("button")?.click());
    expect(add).toHaveBeenCalledWith({
      npub: newcomer.npub,
      name: newcomer.name,
      lnAddress: "",
      pictureUrl: null,
      query: newcomer.npub,
      isExactMatch: true,
    });
    expect(search).not.toHaveBeenCalled();

    await rendered.rerender(page(false));
    expect(
      rendered.container.querySelector(".bluetooth-nearby-users"),
    ).toBeNull();
    await rendered.unmount();
  });
});
