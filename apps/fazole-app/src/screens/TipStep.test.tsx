import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { CzkAmount, type TipChoice } from "../domain";
import { formatCzk } from "../format";
import { fakeDevice } from "../testing/fakeDevice";
import { byTestId, render } from "../testing/render";
import { TipStep } from "./TipStep";

// Intl groups and suffixes with non-breaking spaces.
const czk = (halere: number) => formatCzk(CzkAmount.make(halere));

const press = (container: HTMLElement, testId: string) =>
  act(async () => byTestId<HTMLButtonElement>(container, testId).click());

const renderTipStep = async () => {
  const onChoose = vi.fn<(choice: TipChoice) => void>();
  const container = await render(
    <TipStep
      base={CzkAmount.make(12_550)}
      busy={false}
      onChoose={onChoose}
      onBack={() => {}}
    />,
    fakeDevice(),
  );
  return { container, onChoose };
};

describe("the tip step", () => {
  it("shows the total each tip charges, and the base amount without one", async () => {
    const { container } = await renderTipStep();
    expect(byTestId(container, "tip-5pct").textContent).toContain(czk(13_178));
    expect(byTestId(container, "tip-50czk").textContent).toContain(czk(17_550));
    expect(byTestId(container, "tip-none").textContent).toContain(czk(12_550));
  });

  it("charges the chosen tip", async () => {
    const { container, onChoose } = await renderTipStep();
    await press(container, "tip-10pct");
    expect(onChoose).toHaveBeenCalledWith({ kind: "percent", percent: 10 });
  });

  it("takes a custom tip from the keypad", async () => {
    const { container, onChoose } = await renderTipStep();
    await press(container, "tip-custom");
    for (const key of ["1", "5"]) {
      await act(async () =>
        [...container.querySelectorAll("button")]
          .find((button) => button.textContent === key)
          ?.click(),
      );
    }
    expect(byTestId(container, "tip-custom").textContent).toContain(
      czk(14_050),
    );
    await press(container, "tip-custom-confirm");
    expect(onChoose).toHaveBeenCalledWith({ kind: "fixed", tipCzk: 1_500 });
  });
});
