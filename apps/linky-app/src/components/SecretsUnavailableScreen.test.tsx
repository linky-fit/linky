import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { SecretsUnavailableScreen } from "./SecretsUnavailableScreen";

const t = (key: string) => key;

const press = async (label: string) => {
  const target = Array.from(
    document.body.querySelectorAll('[role="button"], button'),
  ).find((element) => element.textContent === label);
  if (!target) throw new Error(`No control labeled ${label}`);
  await act(async () => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

describe("SecretsUnavailableScreen", () => {
  it("explains the failure and offers retry or continue", async () => {
    const onRetry = vi.fn();
    const onContinue = vi.fn();
    const view = await renderIntoDocument(
      <SecretsUnavailableScreen
        onContinue={onContinue}
        onRetry={onRetry}
        t={t}
      />,
    );

    expect(view.container.textContent).toContain("secretsUnavailableBody");
    await press("secretsUnavailableRetry");
    expect(onRetry).toHaveBeenCalledTimes(1);
    await press("secretsUnavailableContinue");
    expect(onContinue).toHaveBeenCalledTimes(1);
    await view.unmount();
  });
});
