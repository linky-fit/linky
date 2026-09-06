import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { LinkPreviewCard } from "./LinkPreviewCard";

describe("LinkPreviewCard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("renders fetched page metadata as an external link", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              description: "Simple Bitcoin messaging and payments.",
              faviconUrl: "https://linky.fit/icon.svg",
              imageUrl: null,
              siteName: "linky.fit",
              title: "Linky",
              url: "https://linky.fit/",
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    const { container } = await renderIntoDocument(
      <LinkPreviewCard url="https://linky.fit/test-preview" />,
    );
    await Promise.resolve();
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0);
    });

    const link = container.querySelector("a.chat-link-preview");
    if (!link) throw new Error("Expected link preview anchor");
    expect(link.getAttribute("href")).toBe("https://linky.fit/");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(container.textContent).toContain(
      "Simple Bitcoin messaging and payments.",
    );
  });
});
