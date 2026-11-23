import { describe, expect, it } from "vitest";
import { render } from "../test/render";
import { ListRow } from "./lists";

describe("ListRow", () => {
  it("uses valid button ARIA instead of aria-selected", async () => {
    const container = await render(
      <>
        <ListRow title="Choice" selected onPress={() => {}} />
        <ListRow title="Other" selected={false} onPress={() => {}} />
        <ListRow title="Active nav" active onPress={() => {}} />
        <ListRow title="Plain link" onPress={() => {}} />
        <ListRow title="Static" value="100 sat" />
      </>,
    );
    const buttons = Array.from(container.querySelectorAll("button"));
    for (const button of buttons) {
      expect(button.hasAttribute("aria-selected")).toBe(false);
    }
    expect(buttons[0]?.getAttribute("aria-pressed")).toBe("true");
    expect(buttons[1]?.getAttribute("aria-pressed")).toBe("false");
    expect(buttons[2]?.getAttribute("aria-current")).toBe("true");
    expect(buttons[2]?.hasAttribute("aria-pressed")).toBe(false);
    expect(buttons[3]?.hasAttribute("aria-pressed")).toBe(false);
    expect(buttons[3]?.hasAttribute("aria-current")).toBe(false);
  });

  it("exposes current values on pressable rows without hiding them behind a repeated title label", async () => {
    const container = await render(
      <>
        <ListRow title="Language" value="English" onPress={() => {}} />
        <ListRow title="Balance" value="100 sat" />
      </>,
    );
    const button = container.querySelector("button");
    expect(button?.textContent).toBe("LanguageEnglish");
    expect(button?.querySelector('[aria-label="Language"]')).toBeNull();
    expect(container.querySelector('[aria-label="Balance"]')?.textContent).toBe(
      "100 sat",
    );
  });
});
