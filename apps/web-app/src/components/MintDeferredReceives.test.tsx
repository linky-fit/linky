import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MintSettingsContextValue } from "../app/context/SystemSettingsContexts";
import { createTransferFixture } from "../testUtils/cashuInventory";
import { createMintSettings } from "../testUtils/mintSettings";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { MintDeferredReceives } from "./MintDeferredReceives";

let mintSettings: MintSettingsContextValue;

const { copyText } = vi.hoisted(() => ({
  copyText: vi.fn<(text: string) => Promise<void>>(async () => {}),
}));

vi.mock("../app/context/AppShellContexts", () => ({
  useAppShellActions: () => ({ copyText }),
  useAppShellCore: () => ({
    formatDisplayedAmountText: (amount: number) => `${amount} sat`,
    t: (key: string) =>
      key === "cashuDeferredDiscardBody" ? "lose {amount}?" : key,
  }),
}));

vi.mock("../app/context/SystemSettingsContexts", () => ({
  useMintSettingsContext: () => mintSettings,
}));

const waiting = createTransferFixture({
  id: "AQEBAQEBAQEBAQEBAQEBAQ",
  kind: "deferredReceive",
  status: "pending",
  mint: "https://cashu.cz",
  amount: 21,
  tokenText: "cashuBwaiting",
});

const elsewhere = createTransferFixture({
  id: "AgICAgICAgICAgICAgICAg",
  kind: "deferredReceive",
  status: "pending",
  mint: "https://offline.example",
  amount: 5,
  tokenText: "cashuBelsewhere",
});

const buttonsIn = (root: ParentNode, text: string): HTMLButtonElement[] =>
  Array.from(root.querySelectorAll("button")).filter(
    (button) => button.textContent === text,
  );

const press = async (button: HTMLButtonElement | undefined) => {
  if (button === undefined) throw new Error("button missing");
  await act(async () => {
    button.click();
  });
};

const dialog = () => document.querySelector('[role="dialog"]');

const renderSection = () => {
  mintSettings = createMintSettings({
    cashuDeferredReceives: [waiting, elsewhere],
  });
  return renderIntoDocument(<MintDeferredReceives mint="https://cashu.cz" />);
};

describe("MintDeferredReceives", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    copyText.mockClear();
  });

  it("renders nothing for a mint no token waits for", async () => {
    mintSettings = createMintSettings({ cashuDeferredReceives: [elsewhere] });

    const { container, unmount } = await renderIntoDocument(
      <MintDeferredReceives mint="https://cashu.cz" />,
    );

    expect(container.innerHTML).toBe("");
    await unmount();
  });

  it("lists only this mint's deferrals and copies the token text", async () => {
    const { container, unmount } = await renderSection();

    expect(container.querySelectorAll(".mint-deferred-receive")).toHaveLength(
      1,
    );
    await press(buttonsIn(container, "cashuDeferredCopyToken")[0]);
    expect(copyText).toHaveBeenCalledWith("cashuBwaiting");
    await unmount();
  });

  it("discards a deferral only after the warning is confirmed", async () => {
    const { container, unmount } = await renderSection();

    await press(buttonsIn(container, "cashuDeferredDiscard")[0]);
    const warning = dialog();
    if (warning === null) throw new Error("dialog missing");
    expect(warning.textContent).toContain("lose 21 sat?");
    expect(mintSettings.discardCashuDeferredReceive).not.toHaveBeenCalled();

    await press(buttonsIn(warning, "cashuDeferredCopyToken")[0]);
    expect(copyText).toHaveBeenCalledWith("cashuBwaiting");

    await press(buttonsIn(warning, "cashuDeferredDiscard")[0]);
    expect(mintSettings.discardCashuDeferredReceive).toHaveBeenCalledWith(
      waiting.id,
    );
    expect(dialog()).toBeNull();
    await unmount();
  });

  it("disables the warning while the discard runs and closes it once the discard ends, whatever its outcome", async () => {
    const { container, unmount } = await renderSection();
    let endDiscard = (): void => undefined;
    vi.mocked(mintSettings.discardCashuDeferredReceive).mockImplementation(
      () =>
        new Promise((resolve) => {
          endDiscard = resolve;
        }),
    );

    await press(buttonsIn(container, "cashuDeferredDiscard")[0]);
    const warning = dialog();
    if (warning === null) throw new Error("dialog missing");
    await press(buttonsIn(warning, "cashuDeferredDiscard")[0]);
    expect(dialog()).not.toBeNull();
    const sheetButtons = Array.from(warning.querySelectorAll("button"));
    expect(sheetButtons.every((button) => button.disabled)).toBe(true);
    await press(buttonsIn(warning, "cashuDeferredDiscard")[0]);
    expect(mintSettings.discardCashuDeferredReceive).toHaveBeenCalledOnce();

    await act(async () => endDiscard());
    expect(dialog()).toBeNull();
    await unmount();
  });

  it("keeps the deferral when the warning is cancelled", async () => {
    const { container, unmount } = await renderSection();

    await press(buttonsIn(container, "cashuDeferredDiscard")[0]);
    const warning = dialog();
    if (warning === null) throw new Error("dialog missing");
    await press(buttonsIn(warning, "cancel")[0]);

    expect(dialog()).toBeNull();
    expect(mintSettings.discardCashuDeferredReceive).not.toHaveBeenCalled();
    await unmount();
  });
});
