import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { ShareOptionsModal } from "./ShareOptionsModal";

afterEach(() => {
  document.body.innerHTML = "";
});

const button = (name: string) =>
  [...document.querySelectorAll("button")].find(
    (element) => element.textContent === name,
  );

describe("ShareOptionsModal", () => {
  it("shows the prepared text and runs the chosen action", async () => {
    const onWhatsApp = vi.fn();
    const onClose = vi.fn();
    const { unmount } = await renderIntoDocument(
      <ShareOptionsModal
        onClose={onClose}
        onCopy={vi.fn()}
        onEmail={vi.fn()}
        onSms={vi.fn()}
        onWhatsApp={onWhatsApp}
        shareText="Pay me on Linky"
        t={(key) => key}
      />,
    );

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("shareOptionsTitle");
    expect(document.querySelector("textarea")?.value).toBe("Pay me on Linky");

    await act(async () => button("shareViaWhatsApp")?.click());
    expect(onWhatsApp).toHaveBeenCalledOnce();
    await act(async () =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    );
    expect(onClose).toHaveBeenCalled();

    await unmount();
  });
});
