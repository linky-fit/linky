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
        onSelect={vi.fn()}
        tokenInfo={null}
      />,
    );
    expect(markup).toContain("Alice (npub1remote)");
    expect(markup).not.toContain("\u202e");
    expect(markup).toContain(">A<");
    expect(markup).not.toContain("A(");
    expect(remote.name).toBe("Ali\u202ece");
  });

  it("marks the title when a status is rendered next to the name", () => {
    const contact = { id: "c", name: "Alice", npub: "npub1alice" };
    const render = (statusText: string | null) =>
      renderToStaticMarkup(
        <ContactCard
          contact={contact}
          nameLabel="Alice"
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
    const withStatus = render("Away for a while");
    expect(withStatus).toContain('class="contact-title has-status"');
    expect(withStatus).toContain('<bdi dir="auto">Away for a while</bdi>');
    expect(render(null)).toContain('class="contact-title"');
  });
});
