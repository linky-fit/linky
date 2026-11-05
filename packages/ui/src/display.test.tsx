import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "../test/render";
import { Amount, Avatar } from "./display";

const glyph = async (name: string) =>
  (await render(<Avatar name={name} />)).querySelector("[role=img]")
    ?.textContent;

describe("Avatar", () => {
  it("shows up to two initials of the name", async () => {
    expect(await glyph("ada lovelace byron")).toBe("AL");
  });

  it("shows a question mark without a name", async () => {
    expect(await glyph(" ")).toBe("?");
  });
});

describe("Amount", () => {
  const fontSize = async (value: string) => {
    const container = await render(<Amount value={value} size="xl" />);
    const text = [...container.querySelectorAll("*")].find(
      (node) => node.textContent === value && node.children.length === 0,
    );
    return text && getComputedStyle(text).fontSize;
  };

  afterEach(() => vi.restoreAllMocks());

  it("shows an xl value that fits at headline size", async () => {
    expect(await fontSize("1 250")).toBe("80px");
  });

  it("shrinks an xl value until it fits its width", async () => {
    // jsdom lays nothing out: the text is five font sizes wide in a 200 px box.
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(
      function (this: HTMLElement) {
        return parseFloat(getComputedStyle(this).fontSize) * 5;
      },
    );
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(200);
    expect(await fontSize("999 999,99")).toBe("40px");
  });
});
