import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { ContactNewPage } from "./ContactNewPage";

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
});
