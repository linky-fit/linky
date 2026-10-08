import {
  derivePubkey,
  encodeNpub,
  NostrSecretKey,
  type Pubkey,
} from "@linky-fit/linkstr";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { ContactNewPage } from "./ContactNewPage";

const beacon = vi.hoisted(() => ({
  identities: new Array<Pubkey>(),
  useIdentityScan: vi.fn(),
}));

vi.mock("../app/hooks/useBeacon", () => ({
  useIdentityScan: beacon.useIdentityScan,
  useNearbyIdentities: () => beacon.identities,
}));

describe("ContactNewPage", () => {
  afterEach(() => {
    vi.useRealTimers();
    beacon.identities = [];
    document.body.innerHTML = "";
  });

  it("scans for nearby npubs and lists them with their profile above the suggestions", async () => {
    const known = derivePubkey(NostrSecretKey.make(new Uint8Array(32).fill(4)));
    const unknown = derivePubkey(
      NostrSecretKey.make(new Uint8Array(32).fill(5)),
    );
    beacon.identities = [known, unknown];
    const addNewContactFromSearchResult = vi.fn(async () => {});
    const searchNewContact = vi.fn(async (query?: string) =>
      query === encodeNpub(known)
        ? {
            kind: "found" as const,
            contacts: [
              {
                isExactMatch: true,
                lnAddress: "",
                name: "Dana Kral",
                npub: encodeNpub(known),
                pictureUrl: null,
                query: encodeNpub(known),
              },
            ],
          }
        : { kind: "not_found" as const, query: query ?? "" },
    );

    const { container, unmount } = await renderIntoDocument(
      <ContactNewPage
        addNewContactFromSearchResult={addNewContactFromSearchResult}
        contactSuggestions={[
          {
            displayLnAddress: "eva@linky.fit",
            lnAddress: "eva@linky.fit",
            name: "Eva",
            npub: "npub1eva",
            pictureUrl: null,
            query: "eva@linky.fit",
          },
        ]}
        form={{ groups: [], lnAddress: "", name: "", npub: "" }}
        groupNames={[]}
        handleSaveContact={() => {}}
        isSavingContact={false}
        searchNewContact={searchNewContact}
        setForm={() => {}}
        t={(key) => key}
      />,
    );

    expect(beacon.useIdentityScan).toHaveBeenCalled();
    expect(searchNewContact).toHaveBeenCalledTimes(2);
    expect(
      [...container.querySelectorAll('[role="heading"]')].map(
        (element) => element.textContent,
      ),
    ).toEqual(["nearby", "contactSuggestionsTitle"]);
    expect(container.textContent).toContain("Dana Kral");
    expect(container.textContent).toContain(encodeNpub(unknown).slice(0, 10));

    const [addDana] = [...container.querySelectorAll("button")].filter(
      (button) => button.textContent === "saveContact",
    );
    await act(async () => addDana?.click());
    expect(addNewContactFromSearchResult).toHaveBeenCalledWith(
      expect.objectContaining({
        isExactMatch: false,
        name: "Dana Kral",
        npub: encodeNpub(known),
      }),
    );
    await unmount();
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

    const rows = container.querySelectorAll(
      '[data-testid="contact-new-search-result"]',
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.getAttribute("aria-selected")).toBe("true");
    expect(rows[0]?.textContent).toContain("Alice");
    expect(rows[1]?.getAttribute("aria-selected")).toBe("false");
    expect(rows[1]?.textContent).toContain("Alice Cooper");

    await act(async () => root.unmount());
  });
});
