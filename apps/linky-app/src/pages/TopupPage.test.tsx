import { AtomRegistry, RegistryContext } from "@linky-fit/linkstr-react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { TopupPage } from "./TopupPage";

const mocks = vi.hoisted(() => ({
  openReceiveScan: vi.fn<() => void>(),
  pasteFromClipboard: vi.fn<() => Promise<boolean>>(),
  pasteScanValue: vi.fn<(entryPoint?: string) => Promise<void>>(),
}));

vi.mock("../app/hooks/shell", async () =>
  (await import("../testUtils/shellHooks")).shellHooksMock(),
);
vi.mock("../app/hooks/shell/scan", () => ({
  useScanCommands: () => ({
    openReceiveScan: mocks.openReceiveScan,
    pasteScanValue: mocks.pasteScanValue,
  }),
}));
vi.mock("../app/hooks/topup/useTopupFlow", () => ({
  useTopupInvoice: () => ({
    setTopupAmount: vi.fn(),
    setTopupNote: vi.fn(),
    topupAmount: "",
    topupInvoiceIsBusy: false,
    topupNote: "",
  }),
}));
vi.mock("../app/hooks/useOnchainTransfers", () => ({
  useOnchainTransfersShown: () => false,
}));
vi.mock("../components/AmountKeypad", () => ({
  AmountKeypad: () => null,
}));
vi.mock("../components/PaymentNoteInput", () => ({
  PaymentNoteInput: () => null,
}));
vi.mock("../components/useAmountInputKeypad", () => ({
  useAmountInputKeypad: () => ({
    decimalKeyEnabled: false,
    inputDisplayValue: null,
    onKeyPress: vi.fn(),
    pasteFromClipboard: mocks.pasteFromClipboard,
  }),
}));

const button = (container: HTMLElement, label: string) =>
  Array.from(container.querySelectorAll("button")).find(
    (element) => element.textContent === label,
  );

afterEach(() => {
  mocks.openReceiveScan.mockReset();
  mocks.pasteFromClipboard.mockReset();
  mocks.pasteScanValue.mockReset();
  document.body.innerHTML = "";
});

describe("TopupPage", () => {
  it("pastes non-numeric clipboard text in receive mode", async () => {
    mocks.pasteFromClipboard.mockResolvedValue(false);
    mocks.pasteScanValue.mockResolvedValue(undefined);

    const { container } = await renderIntoDocument(
      <RegistryContext.Provider value={AtomRegistry.make()}>
        <TopupPage />
      </RegistryContext.Provider>,
    );

    await act(async () => {
      button(container, "paste")?.click();
    });

    expect(mocks.pasteScanValue).toHaveBeenCalledExactlyOnceWith("receive");
  });

  it("does not fall through to scan paste when clipboard holds an amount", async () => {
    mocks.pasteFromClipboard.mockResolvedValue(true);

    const { container } = await renderIntoDocument(
      <RegistryContext.Provider value={AtomRegistry.make()}>
        <TopupPage />
      </RegistryContext.Provider>,
    );

    await act(async () => {
      button(container, "paste")?.click();
    });

    expect(mocks.pasteFromClipboard).toHaveBeenCalledOnce();
    expect(mocks.pasteScanValue).not.toHaveBeenCalled();
  });

  it("opens receive mode scanning from the body scan action", async () => {
    const { container } = await renderIntoDocument(
      <RegistryContext.Provider value={AtomRegistry.make()}>
        <TopupPage />
      </RegistryContext.Provider>,
    );

    await act(async () => {
      button(container, "scan")?.click();
    });

    expect(mocks.openReceiveScan).toHaveBeenCalledOnce();
  });
});
