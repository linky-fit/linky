import { createId } from "@linky-fit/domain";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import type {
  OperatorTransferStatus,
  OnchainTransferDirection,
} from "@linky-fit/onchain-transfer";
import type { OperatorTransfer } from "../transfer";

const user = makeIdentity().pubkey;

/** A transfer with the update `status` would carry; `null` for an unanswered request. */
export const operatorTransferOf = ({
  status,
  direction = "send",
  amount = 100_000,
  fee = 1_000,
  createdAtSec = 1_700_000_000,
}: {
  readonly status: OperatorTransferStatus | null;
  readonly direction?: OnchainTransferDirection;
  readonly amount?: number;
  readonly fee?: number;
  readonly createdAtSec?: number;
}): OperatorTransfer => {
  const id = createId<"OnchainTransfer">();
  return {
    id,
    createdAtSec,
    user,
    direction,
    amount,
    feeBasisPoints: 100,
    payoutAddress: null,
    refund: null,
    userPaymentRequest: null,
    operatorPaymentRequest: null,
    depositAddress: null,
    addressIndex: null,
    update:
      status === null
        ? null
        : {
            v: 1,
            type: "update",
            transferId: id,
            revision: 1,
            status,
            fee,
            sendAmount: amount + fee,
          },
    userCancelledAtSec: null,
  };
};
