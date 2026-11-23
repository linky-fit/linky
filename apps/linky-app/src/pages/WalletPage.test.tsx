import { AtomRegistry, RegistryContext } from "@linky-fit/linkstr-react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { navigateTo } from "../hooks/useRouting";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { WalletHistoryPage, WalletPage } from "./WalletPage";

const state = vi.hoisted(() => ({
  orders: new Array<{ id: string }>(),
  entries: new Array<{ kind: "transaction"; item: { id: string } }>(),
}));

vi.mock("../app/hooks/shell", async () =>
  (await import("../testUtils/shellHooks")).shellHooksMock(),
);
vi.mock("../app/hooks/payments/useRecurringPaymentOrders", () => ({
  useRecurringPaymentOrders: () => state.orders,
}));
vi.mock("../app/hooks/payments/useTransactionHistory", () => ({
  useTransactionHistory: () => ({
    entries: state.entries,
    t: (key: string) => key,
  }),
}));
vi.mock("../components/TransactionRow", () => ({
  TransactionRow: ({
    item,
    onPress,
  }: {
    item: { id: string };
    onPress: () => void;
  }) => (
    <button type="button" data-testid={`tx-${item.id}`} onClick={onPress}>
      {item.id}
    </button>
  ),
}));
vi.mock("../app/hooks/useOnchainTransfers", () => ({
  useOnchainTransfers: () => [],
}));
vi.mock("../app/hooks/wallet/useWalletInventory", () => ({
  useWalletBalance: () => ({ cashuTotalBalance: 0 }),
}));
vi.mock("../components/DisplayAmount", () => ({ DisplayAmount: () => null }));
vi.mock("../components/WalletPendingReceives", () => ({
  WalletPendingReceives: () => null,
}));
vi.mock("../components/RecurringPaymentsList", () => ({
  RecurringPaymentsList: () => <div data-testid="recurring-list" />,
}));
vi.mock("../hooks/useRouting", () => ({ navigateTo: vi.fn() }));

const renderInRegistry = (element: React.ReactElement) =>
  renderIntoDocument(
    <RegistryContext.Provider value={AtomRegistry.make()}>
      {element}
    </RegistryContext.Provider>,
  );
const closeScan = vi.fn();
const renderWallet = () =>
  renderInRegistry(
    <WalletPage closeScan={closeScan} openScan={vi.fn()} scanIsOpen />,
  );
const renderHistory = () => renderInRegistry(<WalletHistoryPage />);

const button = (container: HTMLElement, label: string) =>
  Array.from(container.querySelectorAll("button")).find(
    (element) =>
      element.textContent === label ||
      element.getAttribute("aria-label") === label,
  );

afterEach(() => {
  state.orders = [];
  state.entries = [];
  vi.mocked(navigateTo).mockClear();
  closeScan.mockClear();
});

describe("WalletPage", () => {
  it("omits the recent transactions section while empty and opens History from its button", async () => {
    const { container } = await renderWallet();

    expect(container.textContent).not.toContain("transactionsTitle");
    expect(button(container, "recurringPaymentNewTitle")).toBeUndefined();
    await act(async () => {
      button(container, "walletHistory")?.click();
    });
    expect(navigateTo).toHaveBeenCalledWith({ route: "walletHistory" });
  });

  it("surfaces up to 4 recent transactions directly on the wallet and closes scan when opening one", async () => {
    state.entries = ["tx-1", "tx-2", "tx-3", "tx-4", "tx-5"].map((id) => ({
      kind: "transaction",
      item: { id },
    }));
    const { container } = await renderWallet();

    expect(container.textContent).toContain("transactionsTitle");
    expect(container.querySelector('[data-testid="tx-tx-1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="tx-tx-4"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="tx-tx-5"]')).toBeNull();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="tx-tx-2"]')
        ?.click();
    });
    expect(closeScan).toHaveBeenCalledOnce();
    expect(navigateTo).toHaveBeenCalledWith({
      route: "transaction",
      id: "tx-2",
    });
  });

  it("closes the open scanner before it opens History or Receive", async () => {
    const { container } = await renderWallet();

    for (const label of ["walletHistory", "walletReceive"]) {
      closeScan.mockClear();
      await act(async () => {
        button(container, label)?.click();
      });
      expect(closeScan).toHaveBeenCalledOnce();
    }
    expect(navigateTo).toHaveBeenCalledWith({ route: "topup" });
  });
});

describe("WalletHistoryPage", () => {
  it("explains recurring payments while there are none, with the button to add one", async () => {
    const { container } = await renderHistory();

    expect(container.textContent).toContain("recurringEmptyHint");
    await act(async () => {
      button(container, "recurringPaymentNewTitle")?.click();
    });
    expect(navigateTo).toHaveBeenCalledWith({ route: "recurringPaymentNew" });
  });

  it("drops the explanation once a recurring payment exists", async () => {
    state.orders = [{ id: "rp-1" }];
    const { container } = await renderHistory();

    expect(container.textContent).not.toContain("recurringEmptyHint");
    expect(container.querySelector("[data-testid='recurring-list']")).not.toBe(
      null,
    );
    expect(button(container, "recurringPaymentNewTitle")).toBeDefined();
  });
});
