import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createContactNameFormatter } from "../utils/contactName";
import { ContactCard } from "./ContactCard";

vi.mock("../app/context/AppShellContexts", () => ({
  useAppShellCore: () => ({
    formatDisplayedAmountText: String,
    t: (key: string) => key,
  }),
}));

describe("contact identity labels", () => {
  it("renders a disambiguated remote name without changing the selected contact", () => {
    const local = {
      id: "local",
      name: "Alice",
      npub: "npub1local",
      nameSetByUser: 1,
    };
    const remote = { id: "remote", name: "Ali\u202ece", npub: "npub1remote" };
    const nameLabel = createContactNameFormatter([local, remote])(remote);
    const markup = renderToStaticMarkup(
      <ContactCard
        contact={remote}
        nameLabel={nameLabel}
        avatarUrl={null}
        getMintIconUrl={() => ({ url: null })}
        getNpubMessageContactInfo={() => null}
        hasAttention={false}
        onMintIconError={vi.fn()}
        onMintIconLoad={vi.fn()}
        onSelect={vi.fn()}
        tokenInfo={null}
      />,
    );
    expect(markup).toContain("Alice (npub1remote)");
    expect(markup).not.toContain("\u202e");
    expect(remote.name).toBe("Ali\u202ece");
  });
});
