import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { SecretsWriteFailedScreen } from "./SecretsWriteFailedScreen";

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

const render = (onRetry: () => Promise<boolean>, onCancel = vi.fn()) =>
  renderIntoDocument(
    <SecretsWriteFailedScreen
      backupWords="academic acid acne"
      onRetry={onRetry}
      onCancel={onCancel}
      t={t}
    />,
  );

describe("SecretsWriteFailedScreen", () => {
  it("shows the backup words only on request", async () => {
    const view = await render(() => Promise.resolve(true));

    expect(document.body.textContent).not.toContain("academic");
    await press("masterKeysShow");
    expect(document.body.textContent).toContain("academic");
    expect(document.body.textContent).toContain("acne");
    await view.unmount();
  });

  it("says so when a retry is refused again, and cancels", async () => {
    const onRetry = vi.fn(() => Promise.resolve(false));
    const onCancel = vi.fn();
    const view = await render(onRetry, onCancel);

    expect(document.body.textContent).not.toContain("secretsWriteFailedAgain");
    await press("secretsWriteFailedRetry");
    expect(onRetry).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain("secretsWriteFailedAgain");
    await press("cancel");
    expect(onCancel).toHaveBeenCalledOnce();
    await view.unmount();
  });
});
