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
  isAnyAmountReceive,
  sortTransfers,
  transferTerms,
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
