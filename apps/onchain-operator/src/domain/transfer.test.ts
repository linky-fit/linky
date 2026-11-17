import { createId } from "@linky-fit/domain";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import type { OperatorTransferStatus } from "@linky-fit/onchain-transfer";
import { describe, expect, it } from "vitest";
import {
  encodeNostrPaymentRequest,
  PaymentRequestId,
} from "@linky-fit/linkshu";
import { encodeNprofile } from "@linky-fit/linkstr";
import {
  isAmountUnknown,
  isAnyAmountReceive,
  reservedDepositAddresses,
  sortTransfers,
  transferTerms,
  transferWait,
  type OperatorTransfer,
} from "./transfer";

const transferOf = (
  createdAtSec: number,
  status: OperatorTransferStatus | null,
): OperatorTransfer => ({
  id: createId<"OnchainTransfer">(),
  createdAtSec,
  user: makeIdentity().pubkey,
  direction: "send",
  amount: 100_000,
  feeBasisPoints: 250,
  payoutAddress: null,
  refund: null,
  userPaymentRequest: null,
  operatorPaymentRequest: null,
  depositAddress: null,
  addressIndex: null,
  ecashSendId: null,
  update:
    status === null
      ? null
      : {
          v: 1,
          type: "update",
          transferId: createId<"OnchainTransfer">(),
          revision: 1,
          status,
          fee: 1_000,
          sendAmount: 101_000,
        },
  userCancelledAtSec: null,
  closedByHand: null,
  isTest: false,
});

describe("sortTransfers", () => {
  it("lists open transfers oldest first, then the closed ones newest first", () => {
    const transfers = [
      transferOf(1, "completed"),
      transferOf(2, null),
      transferOf(3, "denied"),
      transferOf(4, "fundsReceived"),
      transferOf(5, "accepted"),
    ];
    const { open, closed } = sortTransfers(transfers);
    expect(open.map((transfer) => transfer.createdAtSec)).toEqual([2, 4, 5]);
    expect(closed.map((transfer) => transfer.createdAtSec)).toEqual([3, 1]);
  });

  it("lists cancelled and test transfers apart, newest first", () => {
    const { open, closed, cancelled, tests } = sortTransfers([
      { ...transferOf(1, "accepted"), closedByHand: "cancelled" },
      { ...transferOf(2, null), isTest: true },
      { ...transferOf(3, "completed"), isTest: true },
      transferOf(4, "accepted"),
      transferOf(5, "cancelled"),
      { ...transferOf(6, "accepted"), closedByHand: "completed" },
    ]);
    expect(open.map((transfer) => transfer.createdAtSec)).toEqual([4]);
    expect(closed.map((transfer) => transfer.createdAtSec)).toEqual([6]);
    expect(cancelled.map((transfer) => transfer.createdAtSec)).toEqual([5, 1]);
    expect(tests.map((transfer) => transfer.createdAtSec)).toEqual([3, 2]);
  });
});

describe("transferTerms", () => {
  it("takes the requested fee until an update locked it", () => {
    expect(transferTerms(transferOf(1, null))).toEqual({
      amount: 100_000,
      fee: 2_500,
      sendAmount: 102_500,
    });
    expect(transferTerms(transferOf(1, "accepted"))).toEqual({
      amount: 100_000,
      fee: 1_000,
      sendAmount: 101_000,
    });
  });

  it("reads what the user gets from the update, as a deposit may have set it", () => {
    const transfer = transferOf(1, "fundsSeen");
    expect(
      transferTerms({
        ...transfer,
        update:
          transfer.update === null
            ? null
            : { ...transfer.update, fee: 1_486, sendAmount: 150_000 },
      }),
    ).toEqual({ amount: 148_514, fee: 1_486, sendAmount: 150_000 });
  });
});

const withUpdate = (
  transfer: OperatorTransfer,
  changes: Partial<NonNullable<OperatorTransfer["update"]>>,
): OperatorTransfer => ({
  ...transfer,
  update: transfer.update === null ? null : { ...transfer.update, ...changes },
});

describe("transferWait", () => {
  const send = (status: OperatorTransferStatus | null) => transferOf(1, status);
  const receive = (status: OperatorTransferStatus | null) => ({
    ...transferOf(1, status),
    direction: "receive" as const,
  });
  const cancelled = (transfer: OperatorTransfer) => ({
    ...transfer,
    userCancelledAtSec: 2,
  });

  it("waits for the user's Cashu on a send, then for the operator's payout", () => {
    expect(transferWait(send("accepted"))).toBe("userCashu");
    expect(transferWait(send("fundsReceived"))).toBe("operatorOnchain");
  });

  it("waits for the user's deposit on a receive, then for the operator's Cashu", () => {
    expect(transferWait(receive("accepted"))).toBe("userOnchain");
    expect(transferWait(receive("fundsSeen"))).toBe("userOnchain");
    expect(transferWait(receive("fundsReceived"))).toBe("operatorCashu");
  });

  it("gives a user who cancelled after paying their funds back over the rail they paid on", () => {
    expect(transferWait(cancelled(send("fundsReceived")))).toBe(
      "operatorCashu",
    );
    expect(transferWait(cancelled(receive("fundsSeen")))).toBe(
      "operatorOnchain",
    );
    expect(transferWait(cancelled(receive("fundsReceived")))).toBe(
      "operatorOnchain",
    );
  });

  it("asks the operator to review an unanswered request and waits for nothing once closed", () => {
    expect(transferWait(receive(null))).toBe("review");
    expect(transferWait(send("completed"))).toBeNull();
    expect(
      transferWait({ ...send("fundsReceived"), closedByHand: "completed" }),
    ).toBeNull();
  });
});

describe("reservedDepositAddresses", () => {
  const user = makeIdentity().pubkey;
  const receiveAt = (
    createdAtSec: number,
    status: OperatorTransferStatus,
    depositAddress: string,
    addressIndex: number,
  ): OperatorTransfer => ({
    ...transferOf(createdAtSec, status),
    user,
    direction: "receive",
    depositAddress,
    addressIndex,
  });

  it("lists the user's addresses of closed receives no deposit reached, newest first", () => {
    const reserved = reservedDepositAddresses(
      [
        receiveAt(1, "cancelled", "a", 0),
        receiveAt(2, "accepted", "b", 1),
        { ...receiveAt(3, "accepted", "c", 2), closedByHand: "cancelled" },
        withUpdate(receiveAt(4, "cancelled", "d", 3), { txid: "f".repeat(64) }),
        { ...receiveAt(5, "cancelled", "e", 4), user: makeIdentity().pubkey },
      ],
      user,
    );
    expect(reserved.map(({ address }) => address)).toEqual(["c", "a"]);
    expect(reserved[0]?.addressIndex).toBe(2);
  });

  it("drops an address once a later transfer took it over", () => {
    expect(
      reservedDepositAddresses(
        [receiveAt(1, "cancelled", "a", 0), receiveAt(2, "accepted", "a", 0)],
        user,
      ),
    ).toEqual([]);
    expect(
      reservedDepositAddresses(
        [
          receiveAt(1, "cancelled", "a", 0),
          withUpdate(receiveAt(2, "cancelled", "a", 0), {
            receivedAmount: 1_000,
          }),
        ],
        user,
      ),
    ).toEqual([]);
  });
});

describe("isAmountUnknown", () => {
  const anyAmountReceive = (status: OperatorTransferStatus | null) => ({
    ...transferOf(1, status),
    direction: "receive" as const,
    userPaymentRequest: encodeNostrPaymentRequest({
      amount: null,
      mintUrls: ["http://localhost:3338"],
      recipientNprofile: encodeNprofile(makeIdentity().pubkey, []),
      requestId: PaymentRequestId.make("req"),
    }),
  });

  it("is a receive of any amount until a deposit arrives", () => {
    expect(isAmountUnknown(anyAmountReceive("accepted"))).toBe(true);
    expect(isAmountUnknown(anyAmountReceive("cancelled"))).toBe(true);
    expect(
      isAmountUnknown(
        withUpdate(anyAmountReceive("fundsSeen"), { receivedAmount: 150_000 }),
      ),
    ).toBe(false);
    expect(isAmountUnknown(transferOf(1, "accepted"))).toBe(false);
  });
});

describe("isAnyAmountReceive", () => {
  const request = (amount: number | null) =>
    encodeNostrPaymentRequest({
      amount,
      mintUrls: ["http://localhost:3338"],
      recipientNprofile: encodeNprofile(makeIdentity().pubkey, []),
      requestId: PaymentRequestId.make("req"),
    });

  it("is a receive whose payment request leaves the amount open", () => {
    const receive = { ...transferOf(1, null), direction: "receive" as const };
    expect(
      isAnyAmountReceive({ ...receive, userPaymentRequest: request(null) }),
    ).toBe(true);
    expect(
      isAnyAmountReceive({ ...receive, userPaymentRequest: request(100_000) }),
    ).toBe(false);
    expect(isAnyAmountReceive(receive)).toBe(false);
    expect(
      isAnyAmountReceive({
        ...transferOf(1, null),
        userPaymentRequest: request(null),
      }),
    ).toBe(false);
  });
});
