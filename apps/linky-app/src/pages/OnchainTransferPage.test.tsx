import { bitcoinPaymentUri } from "@linky-fit/onchain-transfer";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OnchainTransferView } from "../app/lib/onchainTransfers";
import {
  REGTEST_ADDRESS,
  onchainTransferUpdateFixture,
  onchainTransferViewFixture,
  TXID,
} from "../testUtils/onchainTransfers";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { OnchainTransferDetail } from "./OnchainTransferPage";

const COPY: Partial<Record<string, string>> = {
  onchainReceiveConfirmations: "{count} of {required}",
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

const txLinks = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("a")).map((link) =>
    link.getAttribute("href"),
  );

const updated = (
  overrides: Parameters<typeof onchainTransferUpdateFixture>[1],
) => onchainTransferUpdateFixture(onchainTransferViewFixture().id, overrides);

describe("OnchainTransferDetail", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("waits for details and cancels only once the user confirms", async () => {
    const { container, onCancel } = await renderDetail(
      onchainTransferViewFixture(),
    );
    expect(container.textContent).toContain(
      "onchainTransferWaitingForDetailsHint",
    );
    expect(byTestId("onchain-transfer-send")).toBeNull();
    expect(byTestId("onchain-transfer-phase")).toBeNull();
    expect(byTestId("onchain-transfer-support")).not.toBeNull();

    await press(byTestId("onchain-transfer-cancel"));
    expect(onCancel).not.toHaveBeenCalled();
    await press(byTestId("onchain-transfer-cancel-confirm"));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("sends the amount plus the service fee of a ready on-chain send, in exact sats", async () => {
    const { container, onSend } = await renderDetail(
      onchainTransferViewFixture({ phase: "readyToSend" }),
    );
    expect(container.textContent).toContain(REGTEST_ADDRESS);
    expect(container.textContent).toContain(
      "onchainTransferYouGet100,000 sat (~100 EUR)",
    );
    expect(container.textContent).toContain(
      "onchainTransferServiceFee1,000 sat (~1 EUR)",
    );
    expect(byTestId("onchain-transfer-total")?.textContent).toBe(
      "onchainSendYouPay101,000 sat (~101 EUR)",
    );
    expect(byTestId("onchain-transfer-send")?.textContent).toBe(
      "Send 101,000 sat (~101 EUR)",
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

  it("asks for the exact sats at the deposit address of a ready on-chain receive", async () => {
    const { container, onCopy } = await renderDetail(
      onchainTransferViewFixture({
        direction: "receive",
        phase: "awaitingDeposit",
        payoutAddress: null,
        refundToSender: true,
        depositAddress: REGTEST_ADDRESS,
      }),
    );
    expect(byTestId("onchain-transfer-deposit-qr")).not.toBeNull();
    expect(container.textContent).toContain("Deposit 101,000 sat (0.00101 ₿)");
    expect(container.textContent).toContain("onchainTransferRefundToSender");
    const paymentUri = bitcoinPaymentUri(REGTEST_ADDRESS, 101_000);
    await press(byTestId("onchain-transfer-deposit-qr"));
    expect(onCopy).toHaveBeenLastCalledWith(paymentUri);
    await press(byTestId("onchain-transfer-copy-payment"));
    expect(onCopy).toHaveBeenLastCalledWith(paymentUri);
    await press(byTestId("onchain-transfer-copy-address"));
    expect(onCopy).toHaveBeenLastCalledWith(REGTEST_ADDRESS);
    expect(byTestId("onchain-transfer-cancel")).not.toBeNull();
  });

  it("counts the deposit's confirmations and links it, with no way to cancel", async () => {
    const { container } = await renderDetail(
      onchainTransferViewFixture({
        direction: "receive",
        phase: "depositSeen",
        depositAddress: REGTEST_ADDRESS,
        update: updated({ status: "fundsSeen", txid: TXID, confirmations: 1 }),
      }),
    );
    expect(container.textContent).toContain("1 of 2");
    expect(container.textContent).toContain("onchainTransferDepositAddress");
    expect(txLinks(container)).toEqual([`https://explorer.example/tx/${TXID}`]);
    expect(byTestId("onchain-transfer-cancel")).toBeNull();
    expect(byTestId("onchain-transfer-deposit-qr")).toBeNull();
  });

  it("tells a sent on-chain send what arrives, then links its payout", async () => {
    const sent = await renderDetail(
      onchainTransferViewFixture({ phase: "sent" }),
    );
    expect(sent.container.textContent).toContain(
      "100,000 sat (~100 EUR) on its way",
    );

    document.body.innerHTML = "";
    const { container } = await renderDetail(
      onchainTransferViewFixture({
        phase: "completed",
        update: updated({ status: "completed", txid: TXID }),
      }),
    );
    expect(container.textContent).toContain("onchainSendCompletedHint");
    expect(container.textContent).toContain("onchainTransferPayoutTransaction");
    expect(txLinks(container)).toEqual([`https://explorer.example/tx/${TXID}`]);
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
    expect(txLinks(refunded.container)).toEqual([
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
  });

  it("tells a completed on-chain receive's deposit apart from what reached the balance", async () => {
    await renderDetail(
      onchainTransferViewFixture({
        direction: "receive",
        phase: "completed",
        update: updated({ status: "completed", receivedAmount: 101_000 }),
      }),
    );
    expect(byTestId("onchain-transfer-received")?.textContent).toBe(
      "onchainReceiveDeposited101,000 sat (~101 EUR)",
    );
    expect(byTestId("onchain-transfer-credited")?.textContent).toBe(
      "onchainReceiveAddedToBalance100,000 sat (~100 EUR)",
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
      "onchainTransferPaid101,000 sat (~101 EUR)",
    );
    expect(byTestId("onchain-transfer-refunded")?.textContent).toBe(
      "onchainTransferRefunded101,000 sat (~101 EUR)",
    );
    expect(container.textContent).toContain("onchainTransferOriginalTerms");
  });
});
