import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MintSettingsContextValue } from "../app/context/SystemSettingsContexts";
import { createTransferFixture } from "../testUtils/cashuInventory";
import { createMintSettings } from "../testUtils/mintSettings";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { WalletPendingReceives } from "./WalletPendingReceives";

let mintSettings: MintSettingsContextValue;

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));

vi.mock("../hooks/useRouting", () => ({
  navigateTo: mockNavigate,
}));

vi.mock("../app/context/AppShellContexts", () => ({
  useAppShellCore: () => ({
    formatDisplayedAmountText: (amount: number) => `${amount} sat`,
    t: (key: string) =>
      key === "mintPendingAmount" ? "{amount} pending" : key,
  }),
}));

vi.mock("../app/context/SystemSettingsContexts", () => ({
  useMintSettingsContext: () => mintSettings,
}));

const deferral = (id: string, mint: string, amount: number) =>
  createTransferFixture({
    id,
    kind: "deferredReceive",
    status: "pending",
    mint,
    amount,
  });

const renderLine = async () => {
  const rendered = await renderIntoDocument(<WalletPendingReceives />);
  const button = rendered.container.querySelector("button.wallet-pending");
  return { ...rendered, button };
};

describe("WalletPendingReceives", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    mockNavigate.mockReset();
  });

  it("renders nothing while no token waits for its mint", async () => {
    mintSettings = createMintSettings();

    const { container, unmount } = await renderLine();

    expect(container.innerHTML).toBe("");
    await unmount();
  });

  it("sums every pending deferral and opens their mint when there is one", async () => {
    mintSettings = createMintSettings({
      cashuDeferredReceives: [
        deferral("AQEBAQEBAQEBAQEBAQEBAQ", "https://cashu.cz", 21),
        deferral("AgICAgICAgICAgICAgICAg", "https://cashu.cz", 5),
      ],
    });

    const { button, unmount } = await renderLine();
    if (!(button instanceof HTMLButtonElement)) throw new Error("line missing");
    expect(button.textContent).toBe("26 sat pending");

    await act(async () => {
      button.click();
    });
    expect(mockNavigate).toHaveBeenCalledWith({
      route: "mint",
      mintUrl: "https://cashu.cz",
    });
    await unmount();
  });

  it("opens the mints page when deferrals wait at several mints", async () => {
    mintSettings = createMintSettings({
      cashuDeferredReceives: [
        deferral("AQEBAQEBAQEBAQEBAQEBAQ", "https://cashu.cz", 21),
        deferral("AgICAgICAgICAgICAgICAg", "https://offline.example", 5),
      ],
    });

    const { button, unmount } = await renderLine();
    if (!(button instanceof HTMLButtonElement)) throw new Error("line missing");

    await act(async () => {
      button.click();
    });
    expect(mockNavigate).toHaveBeenCalledWith({ route: "mints" });
    await unmount();
  });
});
