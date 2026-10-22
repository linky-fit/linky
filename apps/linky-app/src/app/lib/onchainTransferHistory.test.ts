import { describe, expect, it } from "vitest";
import { onchainTransferViewFixture } from "../../testUtils/onchainTransfers";
import { withOnchainTransfers } from "./onchainTransferHistory";
import type { TransactionItem } from "./transactionHistory";

const transaction = (
  id: string,
  createdAtSec: number,
  requestId: string | null = null,
  status: TransactionItem["status"] = "ok",
): TransactionItem => ({
  amount: 101_000,
  category: "contacts",
  contactId: "operator-contact",
  createdAtSec,
  details: requestId === null ? null : { requestId },
  direction: "out",
  error: null,
  fee: null,
  hiddenReason: null,
  id,
  isReturned: false,
  method: "cashu_chat",
  mint: null,
  note: null,
  pendingLabel: null,
  status,
  unit: "sat",
});

describe("withOnchainTransfers", () => {
  it("pins unfinished transfers and places finished ones among the transactions by time", () => {
    const running = onchainTransferViewFixture({
      createdAtSec: 50,
      phase: "sent",
    });
    const done = onchainTransferViewFixture({
      createdAtSec: 20,
      phase: "completed",
    });
    const newer = transaction("newer", 30);
    const older = transaction("older", 10);

    const { pending, entries } = withOnchainTransfers(
      [newer, older],
      [running, done],
    );

    expect(pending).toEqual([running]);
    expect(entries).toEqual([
      { kind: "transaction", item: newer },
      { kind: "onchainTransfer", transfer: done },
      { kind: "transaction", item: older },
    ]);
  });

  it("drops the ecash of a transfer, matched by the NUT-18 request id alone", () => {
    const transfer = onchainTransferViewFixture({
      createdAtSec: 10,
      phase: "completed",
    });
    const payment = transaction("payment", 20, transfer.id);
    const sameAmount = transaction("same-amount", 20, "another-request");

    const { entries } = withOnchainTransfers([payment, sameAmount], [transfer]);

    expect(entries.map((entry) => entry.kind)).toEqual([
      "transaction",
      "onchainTransfer",
    ]);
    expect(entries[0]).toEqual({ kind: "transaction", item: sameAmount });
  });

  it("keeps a transfer's pending or failed ecash visible, so a stuck payment is not paid twice", () => {
    const transfer = onchainTransferViewFixture({
      createdAtSec: 10,
      phase: "readyToSend",
    });
    const pending = transaction("pending", 20, transfer.id, "pending");
    const failed = transaction("failed", 15, transfer.id, "error");

    const { entries } = withOnchainTransfers([pending, failed], [transfer]);

    expect(entries).toEqual([
      { kind: "transaction", item: pending },
      { kind: "transaction", item: failed },
    ]);
  });
});
