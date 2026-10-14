import { describe, expect, it, vi } from "vitest";
import { render } from "../test/render";
import { Pressable } from "./controls";

const { buttonProps } = vi.hoisted(() => {
  const buttonProps: Array<Record<string, unknown>> = [];
  return { buttonProps };
});

vi.mock("tamagui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("tamagui")>()),
  isWeb: false,
  Button: (props: Record<string, unknown>) => {
    buttonProps.push(props);
    return null;
  },
}));

describe("Pressable on native", () => {
  it.each([true, false, undefined])(
    "states aria-disabled for disabled=%s",
    async (disabled) => {
      buttonProps.length = 0;
      await render(<Pressable disabled={disabled} />);
      expect(buttonProps.at(-1)?.["aria-disabled"]).toBe(Boolean(disabled));
    },
  );
});
