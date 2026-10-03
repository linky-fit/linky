import { describe, expect, it } from "vitest";
import { render } from "../test/render";
import { Avatar } from "./display";
import { SUPPORTER_BADGE_KINDS } from "./tokens";
import type { SupporterBadgeKind } from "./tokens";

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

describe("Avatar supporter badge", () => {
  const badge = async (supporter?: SupporterBadgeKind) =>
    (await render(<Avatar name="Ada" supporter={supporter} />)).querySelector(
      "[data-testid=avatar-supporter-badge]",
    );

  it.each(SUPPORTER_BADGE_KINDS)("shows the %s badge", async (kind) => {
    expect(await badge(kind)).not.toBeNull();
  });

  it("shows no badge without a supporter", async () => {
    expect(await badge()).toBeNull();
  });

  it("keeps the avatar named after the person only", async () => {
    const container = await render(<Avatar name="Ada" supporter="gold" />);
    expect(
      [...container.querySelectorAll("[aria-label]")].map((element) =>
        element.getAttribute("aria-label"),
      ),
    ).toEqual(["Ada"]);
  });
});
