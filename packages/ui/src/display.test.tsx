import { describe, expect, it } from "vitest";
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

  it("shows a short xl value at headline size", async () => {
    expect(await fontSize("1 250")).toBe("var(--f-size-headline)");
  });

  it("shrinks a long xl value to the amount size", async () => {
    expect(await fontSize("999 999,99")).toBe("var(--f-size-amount)");
  });
});
