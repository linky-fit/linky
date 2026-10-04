import { describe, expect, it } from "vitest";
import { render } from "../test/render";
import { BulletList, TextLink } from "./layout";

describe("TextLink", () => {
  it("opens other sites in a new tab", async () => {
    const link = (
      await render(<TextLink href="https://example.com">x</TextLink>)
    ).querySelector("a");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("keeps links within the site in the same tab", async () => {
    const link = (
      await render(<TextLink href="/blog/">x</TextLink>)
    ).querySelector("a");
    expect(link?.hasAttribute("target")).toBe(false);
  });
});

describe("BulletList", () => {
  it("renders a list item per entry", async () => {
    const container = await render(<BulletList items={["One", "Two"]} />);
    expect(container.querySelectorAll("ul > li")).toHaveLength(2);
  });
});
