import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "../test/render";
import { Button, IconButton, Pressable } from "./controls";
import { Form, SubmitButton } from "./form";

describe("disabled press targets", () => {
  it.each([
    [
      "Button",
      (onPress: () => void) => (
        <Button disabled onPress={onPress}>
          Pay
        </Button>
      ),
    ],
    [
      "IconButton",
      (onPress: () => void) => (
        <IconButton
          disabled
          icon="X"
          accessibilityLabel="Close"
          onPress={onPress}
        />
      ),
    ],
    [
      "Pressable",
      (onPress: () => void) => <Pressable disabled onPress={onPress} />,
    ],
  ])(
    "%s is a natively disabled button that ignores presses",
    async (_name, element) => {
      const onPress = vi.fn();
      const button = (await render(element(onPress))).querySelector("button");
      expect(button?.disabled).toBe(true);
      await act(async () => button?.click());
      expect(onPress).not.toHaveBeenCalled();
    },
  );

  it("does not submit its form", async () => {
    const onSubmit = vi.fn();
    const container = await render(
      <Form onSubmit={onSubmit}>
        <SubmitButton disabled>Save</SubmitButton>
      </Form>,
    );
    const button = container.querySelector("button");
    expect(button?.type).toBe("submit");
    await act(async () => button?.click());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("stays enabled without the prop", async () => {
    const onPress = vi.fn();
    const button = (
      await render(<Button onPress={onPress}>Pay</Button>)
    ).querySelector("button");
    expect(button?.disabled).toBe(false);
    await act(async () => button?.click());
    expect(onPress).toHaveBeenCalledOnce();
  });
});

describe("tooltip", () => {
  it("is the title of a disabled button on the web", async () => {
    const container = await render(
      <Button disabled tooltip="Not enough funds">
        Pay
      </Button>,
    );
    expect(container.querySelector("button")?.title).toBe("Not enough funds");
  });
});

describe("IconButton indicator", () => {
  it("adds a hidden dot and leaves the button's name to its label", async () => {
    const hiddenParts = async (indicator?: "warning") => {
      const button = (
        await render(
          <IconButton
            icon="Bitcoin"
            indicator={indicator}
            accessibilityLabel="Pending on-chain transaction"
          />,
        )
      ).querySelector("button");
      expect(button?.getAttribute("aria-label")).toBe(
        "Pending on-chain transaction",
      );
      return button?.querySelectorAll('[aria-hidden="true"]').length ?? 0;
    };
    expect((await hiddenParts("warning")) - (await hiddenParts())).toBe(1);
  });
});
