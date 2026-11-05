import {
  Listing,
  ListingAmount,
  ListingCurrency,
  Pubkey,
  SharedListing,
  sharedListingMessageText,
} from "@linky-fit/linkstr";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { createContactNameFormatter } from "../utils/contactName";
import { ContactCard } from "./ContactCard";

vi.mock("../app/hooks/shell", async () =>
  (await import("../testUtils/shellHooks")).shellHooksMock({
    formatDisplayedAmountText: String,
  }),
);

afterEach(() => {
  document.body.innerHTML = "";
});

const renderCard = (
  contact: { id: string; name: string; npub: string },
  nameLabel: string,
  statusText: string | null = null,
) =>
  renderIntoDocument(
    <ContactCard
      contact={contact}
      nameLabel={nameLabel}
      avatarUrl={null}
      getMintIconUrl={() => ({ url: null })}
      getNpubMessageContactInfo={() => null}
      hasAttention={false}
      onMintIconError={vi.fn()}
      onSelect={vi.fn()}
      statusText={statusText}
      tokenInfo={null}
    />,
  );

describe("contact identity labels", () => {
  it("renders a disambiguated remote name without changing the selected contact", async () => {
    const local = {
      id: "local",
      name: "Alice",
      npub: "npub1local",
      nameSetByUser: 1,
    };
    const remote = { id: "remote", name: "Ali\u202ece", npub: "npub1remote" };
    const nameLabel = createContactNameFormatter([local, remote])(remote);
    const { container, unmount } = await renderCard(remote, nameLabel);

    const card = container.querySelector('[data-guide="contact-card"]');
    expect(card?.getAttribute("data-guide-contact-id")).toBe("remote");
    expect(card?.textContent).toContain("Alice (npub1remote)");
    expect(card?.textContent).not.toContain("\u202e");
    expect(container.querySelector('[role="img"]')?.textContent).toBe("A");
    expect(remote.name).toBe("Ali\u202ece");

    await unmount();
  });

  it("renders the status next to the name", async () => {
    const contact = { id: "c", name: "Alice", npub: "npub1alice" };
    const withStatus = await renderCard(contact, "Alice", "Away for a while");
    expect(withStatus.container.textContent).toContain("Away for a while");
    await withStatus.unmount();

    const withoutStatus = await renderCard(contact, "Alice");
    expect(withoutStatus.container.textContent).toBe("AAlice");
    await withoutStatus.unmount();
  });
});

describe("conversation preview", () => {
  it("previews a shared listing as its note, without the lines for older clients", async () => {
    const content = sharedListingMessageText(
      new SharedListing({
        author: Pubkey.make("a".repeat(64)),
        listing: new Listing({
          id: "eggs",
          side: "offer",
          title: "Garden eggs",
          amount: ListingAmount.make("90"),
          currency: ListingCurrency.make("CZK"),
          unit: "per 10",
        }),
      }),
      "Still there?",
    );
    const { container, unmount } = await renderIntoDocument(
      <ContactCard
        contact={{ id: "c", name: "Alice", npub: "npub1alice" }}
        nameLabel="Alice"
        avatarUrl={null}
        getMintIconUrl={() => ({ url: null })}
        getNpubMessageContactInfo={(npub) => ({
          displayName: "Someone",
          isSaved: true,
          npub,
          pictureUrl: null,
        })}
        hasAttention={false}
        lastMessage={{
          contactId: "c",
          content,
          createdAtSec: 1_700_000_000,
          direction: "in",
          id: "message",
          pubkey: "a".repeat(64),
          rumorId: null,
          wrapId: "wrap",
        }}
        onMintIconError={vi.fn()}
        onSelect={vi.fn()}
        statusText={null}
        tokenInfo={null}
      />,
    );

    expect(container.textContent).toContain("Still there?");
    expect(container.textContent).not.toContain("Someone");
    expect(container.textContent).not.toContain("linky:listing");
    await unmount();
  });
});
