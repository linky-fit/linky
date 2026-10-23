import { createId } from "@linky-fit/domain";
import type { OnchainTransferDirection } from "./constants";
import type { OnchainTransferUpdate } from "./messages";
import {
  canUserCancel,
  onchainTransferPhase,
  type OnchainTransferPhase,
} from "./phase";
import type { OperatorTransferStatus } from "./status";

const update = (
  status: OperatorTransferStatus,
  receivedAmount?: number,
): OnchainTransferUpdate => ({
  v: 1,
  type: "update",
  transferId: createId<"OnchainTransfer">(),
  revision: 1,
  status,
  fee: 1_000,
  sendAmount: 101_000,
  ...(receivedAmount === undefined ? {} : { receivedAmount }),
});

const phase = (
  direction: OnchainTransferDirection,
  status: OperatorTransferStatus | null,
  options: {
    readonly cancelled?: boolean;
    readonly sent?: boolean;
    readonly requestPaid?: boolean;
    readonly receivedAmount?: number;
  } = {},
): OnchainTransferPhase =>
  onchainTransferPhase({
    direction,
    update: status === null ? null : update(status, options.receivedAmount),
    userCancelledAtSec: options.cancelled === true ? 1_000 : null,
    sentAtSec: options.sent === true ? 900 : null,
    requestPaid: options.requestPaid ?? false,
  });

describe("onchainTransferPhase of a send", () => {
  it("waits for the operator before any update", () => {
    expect(phase("send", null)).toBe("waitingForDetails");
  });

  it("is ready to send once accepted, and sent once paid", () => {
    expect(phase("send", "accepted")).toBe("readyToSend");
    expect(phase("send", "accepted", { sent: true })).toBe("sent");
    expect(phase("send", "fundsReceived")).toBe("sent");
  });

  it("follows completed, denied, cancelled and refunded updates", () => {
    expect(phase("send", "completed")).toBe("completed");
    expect(phase("send", "denied")).toBe("denied");
    expect(phase("send", "cancelled")).toBe("cancelled");
    expect(phase("send", "refunded", { sent: true })).toBe("refunded");
  });

  it("is cancelled by the user only while nothing was sent", () => {
    expect(phase("send", null, { cancelled: true })).toBe("cancelled");
    expect(phase("send", "accepted", { cancelled: true })).toBe("cancelled");
    expect(phase("send", "accepted", { cancelled: true, sent: true })).toBe(
      "sent",
    );
    expect(phase("send", "fundsReceived", { cancelled: true })).toBe("sent");
  });
});

describe("onchainTransferPhase of a receive", () => {
  it("walks the deposit through to the ecash", () => {
    expect(phase("receive", null)).toBe("waitingForDetails");
    expect(phase("receive", "accepted")).toBe("awaitingDeposit");
    expect(phase("receive", "fundsSeen")).toBe("depositSeen");
    expect(phase("receive", "fundsReceived")).toBe("waitingForEcash");
    expect(phase("receive", "completed", { requestPaid: true })).toBe(
      "completed",
    );
  });

  it("waits for the ecash while only the operator says the transfer completed", () => {
    expect(phase("receive", "completed")).toBe("waitingForEcash");
  });

  it("is a short deposit while less than the amount plus the fee arrived, confirmed or not", () => {
    for (const status of ["fundsSeen", "fundsReceived"] as const) {
      expect(phase("receive", status, { receivedAmount: 50_000 })).toBe(
        "shortDeposit",
      );
      expect(phase("receive", status, { receivedAmount: 101_000 })).not.toBe(
        "shortDeposit",
      );
    }
    expect(
      phase("receive", "fundsSeen", {
        receivedAmount: 50_000,
        cancelled: true,
      }),
    ).toBe("shortDeposit");
    expect(phase("receive", "refunded", { receivedAmount: 50_000 })).toBe(
      "refunded",
    );
  });

  it("is completed once the user's request is paid, whatever the update says", () => {
    expect(phase("receive", "fundsReceived", { requestPaid: true })).toBe(
      "completed",
    );
    expect(phase("receive", null, { requestPaid: true })).toBe("completed");
  });

  it("follows denied, cancelled and refunded updates", () => {
    expect(phase("receive", "denied")).toBe("denied");
    expect(phase("receive", "cancelled")).toBe("cancelled");
    expect(phase("receive", "refunded")).toBe("refunded");
  });

  it("is cancelled by the user only before a deposit is seen", () => {
    expect(phase("receive", null, { cancelled: true })).toBe("cancelled");
    expect(phase("receive", "accepted", { cancelled: true })).toBe("cancelled");
    expect(phase("receive", "fundsSeen", { cancelled: true })).toBe(
      "depositSeen",
    );
    expect(phase("receive", "fundsReceived", { cancelled: true })).toBe(
      "waitingForEcash",
    );
  });
});

describe("canUserCancel", () => {
  const phases: ReadonlyArray<OnchainTransferPhase> = [
    "waitingForDetails",
    "readyToSend",
    "sent",
    "awaitingDeposit",
    "depositSeen",
    "shortDeposit",
    "waitingForEcash",
    "completed",
    "denied",
    "cancelled",
    "refunded",
  ];

  it("allows withdrawing only before funds move", () => {
    expect(phases.filter(canUserCancel)).toEqual([
      "waitingForDetails",
      "readyToSend",
      "awaitingDeposit",
    ]);
  });
});
