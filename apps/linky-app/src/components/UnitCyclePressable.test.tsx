import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type { DisplayCurrency } from "../utils/displayAmounts";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { UnitCyclePressable } from "./UnitCyclePressable";

const shell = vi.hoisted(() => {
  const allowed: DisplayCurrency[] = ["sat", "czk"];
  return { allowed, cycle: vi.fn() };
});

vi.mock("../app/hooks/shell", async () =>
  (await import("../testUtils/shellHooks")).shellHooksMock({
    get allowedDisplayCurrencies() {
      return shell.allowed;
    },
    cycleDisplayCurrency: () => shell.cycle(),
  }),
);

const tapAmount = async (container: HTMLElement) => {
  const amount = container.querySelector('[data-testid="amount"]');
  await act(async () => {
    amount?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  return amount;
};

describe("UnitCyclePressable", () => {
  it("switches the display unit on a tap", async () => {
    shell.cycle.mockClear();
    shell.allowed = ["sat", "czk"];
    const { container } = await renderIntoDocument(
      <UnitCyclePressable testID="amount">21 sat</UnitCyclePressable>,
    );
    expect((await tapAmount(container))?.tagName).toBe("BUTTON");
    expect(shell.cycle).toHaveBeenCalledOnce();
  });

  it("stays plain with one unit or content that ignores the unit", async () => {
    shell.cycle.mockClear();
    shell.allowed = ["sat"];
    const single = await renderIntoDocument(
      <UnitCyclePressable testID="amount">21 sat</UnitCyclePressable>,
    );
    expect((await tapAmount(single.container))?.tagName).not.toBe("BUTTON");
    shell.allowed = ["sat", "czk"];
    const fixed = await renderIntoDocument(
      <UnitCyclePressable testID="amount" cycles={false}>
        5 XXX
      </UnitCyclePressable>,
    );
    expect((await tapAmount(fixed.container))?.tagName).not.toBe("BUTTON");
    expect(shell.cycle).not.toHaveBeenCalled();
  });
});
