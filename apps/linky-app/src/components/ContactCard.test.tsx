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
