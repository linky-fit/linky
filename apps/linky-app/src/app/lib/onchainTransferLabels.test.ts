import { describe, expect, it } from "vitest";
import {
  onchainTransferUpdateFixture,
  onchainTransferViewFixture,
} from "../../testUtils/onchainTransfers";
import { onchainTransferHistoryAmount } from "./onchainTransferLabels";

const transfer = onchainTransferViewFixture();
const ended = (
  phase: "denied" | "cancelled" | "refunded",
  update: Parameters<typeof onchainTransferUpdateFixture>[1] | null = null,
) => ({
  ...transfer,
  phase,
  update:
    update === null ? null : onchainTransferUpdateFixture(transfer.id, update),
});

describe("onchainTransferHistoryAmount", () => {
  it("shows the agreed debit of a send and credit of a receive", () => {
    expect(
      onchainTransferHistoryAmount({ ...transfer, phase: "completed" }),
    ).toBe(101_000);
    expect(
      onchainTransferHistoryAmount({
        ...transfer,
        direction: "receive",
        phase: "awaitingDeposit",
      }),
    ).toBe(100_000);
  });

  it("shows what came back or arrived once a transfer ended otherwise", () => {
    expect(
      onchainTransferHistoryAmount(
        ended("refunded", {
          status: "refunded",
          receivedAmount: 50_000,
          refundAmount: 49_000,
        }),
      ),
    ).toBe(49_000);
    expect(
      onchainTransferHistoryAmount(
        ended("refunded", { status: "refunded", receivedAmount: 50_000 }),
      ),
    ).toBe(50_000);
  });

  it("shows no amount for an ending before any money moved", () => {
    expect(onchainTransferHistoryAmount(ended("cancelled"))).toBeNull();
    expect(
      onchainTransferHistoryAmount(ended("denied", { status: "denied" })),
    ).toBeNull();
  });
});
