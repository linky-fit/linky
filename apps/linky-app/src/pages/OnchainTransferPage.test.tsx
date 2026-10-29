import { bitcoinPaymentUri } from "@linky-fit/onchain-transfer";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OnchainTransferView } from "../app/lib/onchainTransfers";
import {
  REGTEST_ADDRESS,
  onchainTransferUpdateFixture,
  onchainTransferViewFixture,
  TXID,
} from "../testUtils/onchainTransfers";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { groupAddress } from "../utils/formatting";
import { OnchainTransferDetail } from "./OnchainTransferPage";

const COPY: Partial<Record<string, string>> = {
  onchainSendPay: "Send {amount}",
  onchainReceiveAwaitingDepositHint: "Deposit {amount}",
  onchainSendSentHint: "{amount} on its way",
  onchainReceiveShortDepositHint:
    "Got {received}, missing {missing} of {total}",
};

vi.mock("../app/hooks/shell", async () =>
  (await import("../testUtils/shellHooks")).shellHooksMock({
    ...(await import("../testUtils/onchainTransfers")).EUR_DISPLAY,
    t: (key) => COPY[key] ?? key,
  }),
);
vi.mock("../app/hooks/useOnchainTransfers", () => ({}));
vi.mock("../app/hooks/wallet/useWalletInventory", () => ({}));

const byTestId = (id: string) =>
  document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

const press = async (element: Element | null | undefined) => {
  if (!element) throw new Error("nothing to press");
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

const renderDetail = async (
  transfer: OnchainTransferView,
  { canPay = true, sendBusy = false } = {},
) => {
  const handlers = {
    onCancel: vi.fn(),
    onContactSupport: vi.fn(),
    onCopy: vi.fn(),
    onSend: vi.fn(),
  };
  const { container } = await renderIntoDocument(
    <OnchainTransferDetail
      transfer={transfer}
      explorerUrl="https://explorer.example"
      canPay={canPay}
      sendBusy={sendBusy}
      {...handlers}
    />,
  );
  return { container, ...handlers };
};

const openWindow = vi.fn<typeof window.open>(() => null);

/** The explorer pages the transaction rows open, by pressing each of them. */
const txLinks = async (container: HTMLElement) => {
  openWindow.mockClear();
  for (const row of Array.from(
    container.querySelectorAll('[data-testid="onchain-transfer-tx"]'),
  ))
    await press(row);
  return openWindow.mock.calls.map(([url]) => url);
};

const updated = (
  overrides: Parameters<typeof onchainTransferUpdateFixture>[1],
) => onchainTransferUpdateFixture(onchainTransferViewFixture().id, overrides);

describe("OnchainTransferDetail", () => {
  beforeEach(() => {
    vi.stubGlobal("open", openWindow);
  });
  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("waits for the deposit address and cancels only once the user confirms", async () => {
    const { container, onCancel } = await renderDetail(
      onchainTransferViewFixture({
        direction: "receive",
        anyAmount: true,
        payoutAddress: null,
      }),
    );
    expect(container.textContent).toContain(
      "onchainTransferWaitingForDetailsHint",
    );
    expect(byTestId("onchain-transfer-send")).toBeNull();
    expect(byTestId("onchain-transfer-phase")).toBeNull();
    expect(byTestId("onchain-transfer-amount")).toBeNull();
    expect(byTestId("onchain-transfer-support")).toBeNull();

    await press(byTestId("onchain-transfer-cancel"));
    expect(onCancel).not.toHaveBeenCalled();
    await press(byTestId("onchain-transfer-cancel-confirm"));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("offers the payment of a send that did not go out, and no cancel while it is going out", async () => {
    const unpaid = await renderDetail(onchainTransferViewFixture());
    expect(unpaid.container.textContent).toContain("onchainSendUnpaidHint");
    expect(byTestId("onchain-transfer-send")?.textContent).toBe(
      "Send ~101 EUR",
    );
    expect(byTestId("onchain-transfer-cancel")).not.toBeNull();

    document.body.innerHTML = "";
    const paying = await renderDetail(onchainTransferViewFixture(), {
      sendBusy: true,
    });
    expect(paying.container.textContent).toContain("onchainSendPayingHint");
    expect(byTestId("onchain-transfer-cancel")).toBeNull();
  });

  it("shows a ready on-chain send as what arrives, in the display unit, and the payout address in groups of four, and sends the total", async () => {
    const { container, onCopy, onSend } = await renderDetail(
      onchainTransferViewFixture({ phase: "readyToSend" }),
    );
    expect(byTestId("onchain-transfer-amount")?.textContent).toBe(
      "onchainTransferYouGet~100 EUR",
    );
    expect(container.textContent).not.toContain("onchainTransferServiceFee");
    expect(container.textContent).not.toContain("onchainSendYouPay");
    expect(container.textContent).toContain(groupAddress(REGTEST_ADDRESS));
    await press(byTestId("onchain-transfer-payout-address"));
    expect(onCopy).toHaveBeenLastCalledWith(REGTEST_ADDRESS);
    expect(byTestId("onchain-transfer-support")).toBeNull();
    expect(byTestId("onchain-transfer-send")?.textContent).toBe(
      "Send ~101 EUR",
    );
    await press(byTestId("onchain-transfer-send"));
    expect(onSend).toHaveBeenCalledOnce();
  });

  it("offers no send the balance cannot pay, and no cancel while sending", async () => {
    const transfer = onchainTransferViewFixture({ phase: "readyToSend" });
    const poor = await renderDetail(transfer, { canPay: false });
    expect(
      byTestId("onchain-transfer-send")?.getAttribute("aria-disabled"),
    ).toBe("true");
    expect(poor.container.textContent).toContain("payInsufficient");

    document.body.innerHTML = "";
    await renderDetail(transfer, { sendBusy: true });
    expect(byTestId("onchain-transfer-cancel")).toBeNull();
  });

  it("shows a receive of any amount as the bare deposit address in groups of four, with no status, amounts, support or refunds", async () => {
    const { container, onCopy } = await renderDetail(
      onchainTransferViewFixture({
        direction: "receive",
        anyAmount: true,
        phase: "awaitingDeposit",
        payoutAddress: null,
        depositAddress: REGTEST_ADDRESS,
      }),
    );
    expect(container.textContent).toContain(groupAddress(REGTEST_ADDRESS));
    expect(container.textContent).not.toContain(
      "onchainTransferPhaseAwaitingDeposit",
    );
    expect(container.textContent).not.toContain("onchainTransferYouGet");
    expect(container.textContent).not.toContain("onchainTransferRefund");
    expect(byTestId("onchain-transfer-support")).toBeNull();
    expect(byTestId("onchain-transfer-copy-address")).toBeNull();
    await press(byTestId("onchain-transfer-deposit-qr"));
    expect(onCopy).toHaveBeenLastCalledWith(REGTEST_ADDRESS);
    await press(byTestId("onchain-transfer-deposit-address"));
    expect(onCopy).toHaveBeenLastCalledWith(REGTEST_ADDRESS);
    expect(byTestId("onchain-transfer-cancel")).not.toBeNull();
  });

  it("asks for the exact sats at the deposit address of a receive of a fixed amount", async () => {
    const { container, onCopy } = await renderDetail(
      onchainTransferViewFixture({
        direction: "receive",
        phase: "awaitingDeposit",
        payoutAddress: null,
        depositAddress: REGTEST_ADDRESS,
      }),
    );
    expect(byTestId("onchain-transfer-deposit-qr")).not.toBeNull();
    expect(container.textContent).toContain("Deposit 101,000 sat (0.00101 ₿)");
    const paymentUri = bitcoinPaymentUri(REGTEST_ADDRESS, 101_000);
    await press(byTestId("onchain-transfer-deposit-qr"));
    expect(onCopy).toHaveBeenLastCalledWith(paymentUri);
    await press(byTestId("onchain-transfer-deposit-address"));
    expect(onCopy).toHaveBeenLastCalledWith(REGTEST_ADDRESS);
    expect(byTestId("onchain-transfer-cancel")).not.toBeNull();
  });

  it("names the deposit seen, then processing, with only what the user gets and a link to the transaction; no address, support or cancel", async () => {
    const deposit = {
      direction: "receive",
      anyAmount: true,
      depositAddress: REGTEST_ADDRESS,
    } as const;
    const seen = await renderDetail(
      onchainTransferViewFixture({
        ...deposit,
        phase: "depositSeen",
        update: updated({
          status: "fundsSeen",
          txid: TXID,
          confirmations: 0,
          receivedAmount: 101_000,
        }),
      }),
    );
    expect(seen.container.textContent).toContain(
      "onchainTransferPhaseDepositSeen",
    );
    expect(seen.container.textContent).not.toContain(REGTEST_ADDRESS);
    expect(seen.container.textContent).not.toContain(
      groupAddress(REGTEST_ADDRESS),
    );
    expect(seen.container.textContent).toContain(
      "onchainTransferViewTransaction",
    );
    expect(await txLinks(seen.container)).toEqual([
      `https://explorer.example/tx/${TXID}`,
    ]);
    expect(byTestId("onchain-transfer-cancel")).toBeNull();
    expect(byTestId("onchain-transfer-deposit-qr")).toBeNull();
    expect(byTestId("onchain-transfer-support")).toBeNull();

    document.body.innerHTML = "";
    const { container } = await renderDetail(
      onchainTransferViewFixture({
        ...deposit,
        phase: "depositConfirming",
        update: updated({
          status: "fundsSeen",
          txid: TXID,
          confirmations: 1,
          receivedAmount: 101_000,
        }),
      }),
    );
    expect(container.textContent).toContain(
      "onchainTransferPhaseDepositConfirming",
    );
    // The status is the label alone; the amount is what arrives, the fee having been explained before the address.
    expect(container.textContent).not.toMatch(/Hint/u);
    expect(byTestId("onchain-transfer-amount")?.textContent).toBe(
      "onchainTransferYouGet100,000 sat (~100 EUR)",
    );
    expect(byTestId("onchain-transfer-received")).toBeNull();
    expect(container.textContent).not.toContain("1/2");
  });

  it("tells a sent on-chain send what arrives, then links its payout", async () => {
    const sent = await renderDetail(
      onchainTransferViewFixture({ phase: "sent" }),
    );
    expect(sent.container.textContent).toContain("~100 EUR on its way");

    document.body.innerHTML = "";
    const { container } = await renderDetail(
      onchainTransferViewFixture({
        phase: "completed",
        update: updated({ status: "completed", txid: TXID }),
      }),
    );
    expect(container.textContent).toContain("onchainSendCompletedHint");
    expect(container.textContent).toContain("onchainTransferViewTransaction");
    expect(await txLinks(container)).toEqual([
      `https://explorer.example/tx/${TXID}`,
    ]);
  });

  it("shows why it was declined, and links a refund", async () => {
    const denied = await renderDetail(
      onchainTransferViewFixture({
        phase: "denied",
        update: updated({ status: "denied", reason: "Out of coins today" }),
      }),
    );
    expect(denied.container.textContent).toContain("Out of coins today");
    expect(byTestId("onchain-transfer-send")).toBeNull();

    document.body.innerHTML = "";
    const refunded = await renderDetail(
      onchainTransferViewFixture({
        direction: "receive",
        phase: "refunded",
        update: updated({ status: "refunded", refundTxid: TXID }),
      }),
    );
    expect(refunded.container.textContent).toContain(
      "onchainTransferRefundedHint",
    );
    expect(refunded.container.textContent).toContain(
      "onchainTransferViewRefund",
    );
    expect(await txLinks(refunded.container)).toEqual([
      `https://explorer.example/tx/${TXID}`,
    ]);
    await press(byTestId("onchain-transfer-support"));
    expect(refunded.onContactSupport).toHaveBeenCalledOnce();
  });

  it("shows a short deposit as what arrived and what is missing, the agreed amounts only as the original terms", async () => {
    const { container } = await renderDetail(
      onchainTransferViewFixture({
        direction: "receive",
        phase: "shortDeposit",
        depositAddress: REGTEST_ADDRESS,
        update: updated({
          status: "fundsSeen",
          txid: TXID,
          confirmations: 2,
          receivedAmount: 50_000,
        }),
      }),
    );
    expect(container.textContent).toContain(
      "Got 50,000 sat (~50 EUR), missing 51,000 sat (~51 EUR) of 101,000 sat (~101 EUR)",
    );
    expect(byTestId("onchain-transfer-received")?.textContent).toBe(
      "onchainReceiveDeposited50,000 sat (~50 EUR)",
    );
    expect(container.textContent).toContain("onchainTransferOriginalTerms");
    expect(byTestId("onchain-transfer-refunded")).toBeNull();
    expect(byTestId("onchain-transfer-cancel")).toBeNull();
    expect(byTestId("onchain-transfer-support")).not.toBeNull();
  });

  it("shows a completed on-chain receive as what reached the balance, not the deposit again", async () => {
    await renderDetail(
      onchainTransferViewFixture({
        direction: "receive",
        phase: "completed",
        update: updated({ status: "completed", receivedAmount: 101_000 }),
      }),
    );
    expect(byTestId("onchain-transfer-received")).toBeNull();
    expect(byTestId("onchain-transfer-credited")?.textContent).toBe(
      "onchainReceiveAddedToBalance~100 EUR",
    );
  });

  it("shows what a refunded on-chain send paid and got back", async () => {
    const { container } = await renderDetail(
      onchainTransferViewFixture({
        phase: "refunded",
        update: updated({
          status: "refunded",
          receivedAmount: 101_000,
          refundAmount: 101_000,
        }),
      }),
    );
    expect(byTestId("onchain-transfer-received")?.textContent).toBe(
      "onchainTransferPaid~101 EUR",
    );
    expect(byTestId("onchain-transfer-refunded")?.textContent).toBe(
      "onchainTransferRefunded~101 EUR",
    );
    expect(container.textContent).toContain("onchainTransferOriginalTerms");
  });
});
