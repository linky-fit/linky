import { AtomRegistry, RegistryContext } from "@linky-fit/linkstr-react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { navigateTo } from "../hooks/useRouting";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { WalletHistoryPage, WalletPage } from "./WalletPage";

const state = vi.hoisted(() => ({
  orders: new Array<{ id: string }>(),
  hiddenReasons: new Array<string | null>(),
}));

vi.mock("../app/hooks/shell", async () =>
  (await import("../testUtils/shellHooks")).shellHooksMock(),
);
vi.mock("../app/hooks/payments/useRecurringPaymentOrders", () => ({
  useRecurringPaymentOrders: () => state.orders,
}));
vi.mock("../app/hooks/payments/useTransactionHistory", () => ({
  useTransactionHistory: () => ({
    entries: [],
    t: (key: string) => key,
    transactionsById: new Map(
      state.hiddenReasons.map((hiddenReason, index) => [
        `tx-${index}`,
        { hiddenReason },
      ]),
    ),
  }),
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
const renderWallet = () =>
  renderInRegistry(<WalletPage openScan={vi.fn()} scanIsOpen={false} />);
const renderHistory = () => renderInRegistry(<WalletHistoryPage />);

const button = (container: HTMLElement, label: string) =>
  Array.from(container.querySelectorAll("button")).find(
    (element) =>
      element.textContent === label ||
      element.getAttribute("aria-label") === label,
  );

afterEach(() => {
  state.orders = [];
  state.hiddenReasons = [];
  vi.mocked(navigateTo).mockClear();
});

describe("WalletPage", () => {
  it("opens the history from its own button instead of listing it", async () => {
    const { container } = await renderWallet();

    expect(container.textContent).not.toContain("transactionsTitle");
    expect(button(container, "recurringPaymentNewTitle")).toBeUndefined();
    await act(async () => {
      button(container, "walletHistory")?.click();
    });
    expect(navigateTo).toHaveBeenCalledWith({ route: "walletHistory" });
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

  it("offers the hidden-transactions toggle only when some are hidden", async () => {
    state.hiddenReasons = [null];
    const { container, unmount } = await renderHistory();
    expect(button(container, "transactionsShowHidden")).toBeUndefined();
    await unmount();

    state.hiddenReasons = [null, "failed"];
    const rendered = await renderHistory();
    await act(async () => {
      button(rendered.container, "transactionsShowHidden")?.click();
    });
    expect(button(rendered.container, "transactionsHideHidden")).toBeDefined();
  });
});
