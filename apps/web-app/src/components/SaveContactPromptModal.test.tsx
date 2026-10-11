import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { SaveContactPromptModal } from "./SaveContactPromptModal";

vi.mock("../app/hooks/shell", async () =>
  (await import("../testUtils/shellHooks")).shellHooksMock({
    t: (key) =>
      key === "saveContactPromptBody" ? "{amount} {unit} to {lnAddress}" : key,
  }),
);

afterEach(() => {
  document.body.innerHTML = "";
});

describe("SaveContactPromptModal", () => {
  it("offers to save the paid address and closes on skip", async () => {
    const onClose = vi.fn();
    const { unmount } = await renderIntoDocument(
      <SaveContactPromptModal
        amountSat={21}
        lnAddress="alice@linky.fit"
        onClose={onClose}
        setContactNewPrefill={vi.fn()}
      />,
    );

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("saveContactPromptTitle");
    expect(dialog?.textContent).toContain("21 sat to alice@linky.fit");

    const skip = [...document.querySelectorAll("button")].find(
      (element) => element.textContent === "saveContactPromptSkip",
    );
    await act(async () => skip?.click());
    expect(onClose).toHaveBeenCalled();

    await unmount();
  });
});
