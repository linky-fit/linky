import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "../test/render";
import { IconButton } from "./controls";
import { TextField } from "./fields";

describe("text inputs on the web", () => {
  it.each([
    ["single-line", "input", false],
    ["multiline", "textarea", true],
  ] as const)(
    "a %s TextField passes spelling and capitalization hints to the %s",
    async (_name, tag, multiline) => {
      const field = (
        await render(
          <TextField
            label="Name"
            multiline={multiline}
            spellCheck={false}
            autoCorrect={false}
            autoCapitalize="none"
          />,
        )
      ).querySelector(tag);
      expect(field?.getAttribute("spellcheck")).toBe("false");
      expect(field?.getAttribute("autocorrect")).toBe("off");
      expect(field?.getAttribute("autocapitalize")).toBe("off");
    },
  );
});

describe("TextField trailing", () => {
  afterEach(() => vi.restoreAllMocks());
  const renderField = async (trailing: React.ReactNode, multiline = false) => {
    const container = await render(
      <TextField label="Search" multiline={multiline} trailing={trailing} />,
    );
    const input = container.querySelector<HTMLElement>("input, textarea");
    if (!input) throw new Error("no input");
    return { container, input, frame: input.parentElement };
  };
  const clear = <IconButton icon="X" size="sm" accessibilityLabel="Clear" />;

  it("keeps the input's text clear of an action inside the field", async () => {
    // jsdom has no layout; the action measures as an `sm` IconButton (32 px).
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 32, 32),
    );
    const { container, input, frame } = await renderField(clear);
    const button = container.querySelector("[aria-label=Clear]");
    expect(frame?.contains(button)).toBe(true);
    expect(getComputedStyle(input).paddingRight).toBe("56px");
    const slot = button?.parentElement;
    expect(slot && getComputedStyle(slot).position).toBe("absolute");
    expect(slot && getComputedStyle(slot).top).toBe("0px");
  });

  it("pins the action to the bottom row of a multiline field", async () => {
    const { container } = await renderField(clear, true);
    const slot = container.querySelector("[aria-label=Clear]")?.parentElement;
    expect(slot && getComputedStyle(slot).bottom).toBe("12px");
    expect(slot && getComputedStyle(slot).top).not.toBe("0px");
  });

  it("renders a string as a suffix inside the field", async () => {
    const { frame } = await renderField("CZK");
    expect(frame?.textContent).toBe("CZK");
  });
});

describe("TextField events", () => {
  it("reports Enter through onSubmitEditing", async () => {
    const onSubmitEditing = vi.fn();
    const input = (
      await render(
        <TextField label="Search" onSubmitEditing={onSubmitEditing} />,
      )
    ).querySelector("input");
    await act(async () => {
      input?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(onSubmitEditing).toHaveBeenCalledOnce();
  });

  it("offers no DOM event a native field cannot deliver", () => {
    const fields = [
      // @ts-expect-error iOS and Android fake key events without preventDefault; Enter is onSubmitEditing.
      <TextField key="key" label="Search" onKeyDown={() => {}} />,
      <TextField
        key="change"
        label="Search"
        // @ts-expect-error a native change event has nothing but target.value.
        onChange={(event) => event.preventDefault()}
      />,
    ];
    expect(fields).toHaveLength(2);
  });
});
