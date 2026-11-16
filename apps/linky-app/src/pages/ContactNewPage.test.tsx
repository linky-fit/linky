import {
  derivePubkey,
  encodeNpub,
  NostrSecretKey,
  type Pubkey,
} from "@linky-fit/linkstr";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { formatShortNpub } from "../utils/formatting";
import { ContactNewPage } from "./ContactNewPage";

const beacon = vi.hoisted(() => ({
  identities: new Array<Pubkey>(),
  useIdentityScan: vi.fn(),
}));

vi.mock("../app/hooks/useBeacon", () => ({
  useBeaconSupport: () => false,
  useIdentityScan: beacon.useIdentityScan,
  useNearbyIdentities: () => beacon.identities,
}));

type PageProps = React.ComponentProps<typeof ContactNewPage>;

const suggestion = (name: string) => ({
  displayLnAddress: `${name.toLowerCase()}@linky.fit`,
  lnAddress: `${name.toLowerCase()}@linky.fit`,
  name,
  npub: `npub1${name.toLowerCase()}`,
  pictureUrl: null,
  query: `${name.toLowerCase()}@linky.fit`,
});

const renderPage = (overrides: Partial<PageProps> = {}) =>
  renderIntoDocument(
    <ContactNewPage
      addNewContactFromSearchResult={async () => {}}
      contactSuggestions={[]}
      form={{ groups: [], lnAddress: "", name: "", npub: "" }}
      groupNames={[]}
      handleSaveContact={() => {}}
      isSavingContact={false}
      openContactCandidate={() => {}}
      openScan={() => {}}
      searchNewContact={async () => ({ kind: "empty" })}
      setForm={() => {}}
      setStep={() => {}}
      step="search"
      t={(key) => key}
      {...overrides}
    />,
  );

const buttonsOf = (root: Element | null) => [
  ...(root?.querySelectorAll("button") ?? []),
];

describe("ContactNewPage", () => {
  afterEach(() => {
    vi.useRealTimers();
    beacon.identities = [];
    document.body.innerHTML = "";
  });

  it("shows nearby npubs with their profile before new users, three until measured, as tappable avatars", async () => {
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
                isExactMatch: false,
                lnAddress: "",
                name: "Someone Else",
                nip05: "",
                nip05Verified: false,
                npub: encodeNpub(unknown),
                pictureUrl: null,
                query: encodeNpub(known),
                usesLinky: false,
              },
              {
                isExactMatch: true,
                lnAddress: "dana@linky.fit",
                name: "Dana Kral",
                nip05: "",
                nip05Verified: false,
                npub: encodeNpub(known),
                pictureUrl: null,
                query: encodeNpub(known),
                usesLinky: false,
              },
            ],
          }
        : { kind: "not_found" as const, query: query ?? "" },
    );

    const { container, unmount } = await renderPage({
      addNewContactFromSearchResult,
      contactSuggestions: [suggestion("Eva"), suggestion("Filip")],
      searchNewContact,
    });

    expect(beacon.useIdentityScan).toHaveBeenCalled();
    expect(searchNewContact).toHaveBeenCalledTimes(2);
    expect(
      [...container.querySelectorAll('[role="heading"]')].map(
        (element) => element.textContent,
      ),
    ).toEqual(["contactSuggestionsTitle"]);
    const people = buttonsOf(
      container.querySelector(
        '[role="group"][aria-label="contactSuggestionsTitle"]',
      ),
    );
    expect(people.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Dana Kral, nearby",
      `${formatShortNpub(encodeNpub(unknown))}, nearby`,
      "Eva, contactSuggestionNew",
    ]);
    expect(container.textContent).not.toContain("Someone Else");

    await act(async () => people[0]?.click());
    expect(addNewContactFromSearchResult).toHaveBeenCalledWith(
      expect.objectContaining({
        isExactMatch: false,
        name: "Dana Kral",
        nip05: "",
        nip05Verified: false,
        npub: encodeNpub(known),
      }),
    );
    await act(async () => people[2]?.click());
    expect(addNewContactFromSearchResult).toHaveBeenLastCalledWith(
      expect.objectContaining({
        isExactMatch: false,
        name: "Eva",
        nip05: "",
        nip05Verified: false,
        npub: "npub1eva",
      }),
    );
    await unmount();
  });

  it("opens the scanner from the QR button", async () => {
    const openScan = vi.fn();
    const { container, unmount } = await renderPage({ openScan });

    const scan = buttonsOf(container).find(
      (button) => button.textContent === "contactLoadQr",
    );
    expect(scan?.getAttribute("data-guide")).toBe("scan-contact-button");
    await act(async () => scan?.click());
    expect(openScan).toHaveBeenCalledOnce();
    await unmount();
  });

  it("offers to save a typed lightning address before the lookup settles", async () => {
    const setForm = vi.fn();
    const setStep = vi.fn();
    const { container, unmount } = await renderPage({
      form: { groups: [], lnAddress: "", name: "", npub: "alice@example.com" },
      searchNewContact: () => new Promise(() => {}),
      setForm,
      setStep,
    });

    const save = buttonsOf(container).find(
      (button) => button.textContent === "contactSaveLightningAddress",
    );
    expect(save).toBeDefined();
    await act(async () => save?.click());
    expect(setForm).toHaveBeenCalledWith({
      groups: [],
      lnAddress: "alice@example.com",
      name: "",
      npub: "",
    });
    expect(setStep).toHaveBeenCalledWith("details");
    await unmount();
  });

  it("moves to the details when a lightning address is prefilled", async () => {
    const setStep = vi.fn();
    await renderPage({
      form: { groups: [], lnAddress: "alice@example.com", name: "", npub: "" },
      setStep,
    });
    expect(setStep).toHaveBeenCalledWith("details");
  });

  it("shows the details form without a back button of its own", async () => {
    const { container, unmount } = await renderPage({
      form: { groups: [], lnAddress: "alice@example.com", name: "", npub: "" },
      step: "details",
    });

    const inputs = container.querySelectorAll("input");
    expect(inputs).toHaveLength(3);
    expect(inputs[1]?.value).toBe("alice@example.com");
    expect(
      buttonsOf(container).map((button) => button.textContent),
    ).not.toContain("back");
    await unmount();
  });

  it("lists search candidates, checking the verified address and marking whether each uses Linky", async () => {
    vi.useFakeTimers();
    const exact = {
      isExactMatch: true,
      lnAddress: "alice@linky.fit",
      name: "Alice",
      nip05: "alice@linky.fit",
      nip05Verified: true,
      npub: "npub1alice",
      pictureUrl: null,
      query: "alice",
      usesLinky: true,
    };
    const similar = {
      isExactMatch: false,
      lnAddress: "",
      name: "Alice Cooper",
      nip05: "",
      nip05Verified: false,
      npub: "npub1cooper",
      pictureUrl: null,
      query: "alice",
      usesLinky: false,
    };

    const { container, unmount } = await renderPage({
      form: { groups: [], lnAddress: "", name: "", npub: "alice" },
      searchNewContact: async () => ({
        contacts: [exact, similar],
        kind: "found",
      }),
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });

    const rows = container.querySelectorAll(
      '[data-testid="contact-new-search-result"]',
    );
    const marks = (row: Element | undefined) =>
      [...(row?.querySelectorAll('[role="img"][aria-label]') ?? [])]
        .map((mark) => mark.getAttribute("aria-label"))
        .filter((label) => label !== null && /^[a-z]/.test(label));
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain("Alice");
    expect(marks(rows[0])).toEqual(["verifiedNip05", "contactUsesLinky"]);
    expect(rows[0]?.textContent?.match(/alice@linky\.fit/g)).toHaveLength(1);
    expect(rows[1]?.textContent).toContain("Alice Cooper");
    expect(marks(rows[1])).toEqual(["contactUsesNostr"]);
    await unmount();
  });

  it("opens a candidate from its row and saves it only from its button", async () => {
    vi.useFakeTimers();
    const candidate = {
      isExactMatch: true,
      lnAddress: "",
      name: "Bob",
      nip05: "",
      nip05Verified: false,
      npub: "npub1bob",
      pictureUrl: null,
      query: "npub1bob",
      usesLinky: false,
    };
    const openContactCandidate = vi.fn();
    const addNewContactFromSearchResult = vi.fn(async () => {});
    const { container, unmount } = await renderPage({
      addNewContactFromSearchResult,
      form: { groups: [], lnAddress: "", name: "", npub: "npub1bob" },
      openContactCandidate,
      searchNewContact: async () => ({ contacts: [candidate], kind: "found" }),
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });

    const [open, add] = buttonsOf(
      container.querySelector('[data-testid="contact-new-search-result"]'),
    );
    await act(async () => open?.click());
    expect(openContactCandidate).toHaveBeenCalledWith(candidate);
    expect(addNewContactFromSearchResult).not.toHaveBeenCalled();

    expect(add?.textContent).toBe("saveContact");
    await act(async () => add?.click());
    expect(addNewContactFromSearchResult).toHaveBeenCalledWith(candidate);
    expect(openContactCandidate).toHaveBeenCalledOnce();
    await unmount();
  });

  it("offers to open, not save, the user's own identity", async () => {
    vi.useFakeTimers();
    const { container, unmount } = await renderPage({
      form: { groups: [], lnAddress: "", name: "", npub: "npub1me" },
      searchNewContact: async () => ({
        contacts: [
          {
            isExactMatch: true,
            isSelf: true,
            lnAddress: "",
            name: "Me",
            nip05: "",
            nip05Verified: false,
            npub: "npub1me",
            pictureUrl: null,
            query: "npub1me",
            usesLinky: true,
          },
        ],
        kind: "found",
      }),
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });

    const row = container.querySelector(
      '[data-testid="contact-new-search-result"]',
    );
    expect(buttonsOf(row).at(-1)?.textContent).toBe("openContact");
    await unmount();
  });
});
