import { createId } from "@linky-fit/domain";
import {
  encodeNostrPaymentRequest,
  PaymentRequestId,
} from "@linky-fit/linkshu";
import { encodeNprofile } from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import {
  EsploraError,
  type EsploraTransaction,
  type OnchainTransferRequest,
  type OnchainTransferUpdate,
} from "@linky-fit/onchain-transfer";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { OperatorProfile } from "./profile";
import {
  checkPayout,
  depositProgress,
  ecashRefundAmount,
  firstUnusedAddressIndex,
  isDepositNewlyConfirmed,
  isTransferEcash,
  isTxidOfAnotherTransfer,
  nextAddressIndex,
  nextUpdate,
  receivedMismatch,
  refundPaid,
  requestDenyReason,
  sharedDepositAddresses,
} from "./rules";
import type { OperatorTransfer } from "./transfer";

const mint = "http://localhost:3338";
const user = makeIdentity().pubkey;
const payoutAddress =
  "bcrt1p8wpt9v4frpf3tkn0srd97pksgsxc5hs52lafxwru9kgeephvs7rqjeprhg";
const transferId = createId<"OnchainTransfer">();

const profile: OperatorProfile = {
  name: "On-chain operator",
  xpub: "tpub",
  feeBasisPoints: 100,
  paused: false,
  description: "",
  amounts: [100_000, 250_000],
  minClientVersion: null,
  watchers: [],
  picture: null,
};

const userRequest = (args: {
  readonly amount?: number;
  readonly id?: string;
  readonly mints?: readonly string[];
}) =>
  encodeNostrPaymentRequest({
    amount: args.amount ?? 100_000,
    mintUrls: args.mints ?? [mint],
    recipientNprofile: encodeNprofile(user, []),
    requestId: PaymentRequestId.make(args.id ?? transferId),
  });

const send: OnchainTransferRequest = {
  v: 1,
  type: "request",
  transferId,
  direction: "send",
  amount: 100_000,
  feeBasisPoints: 100,
  payoutAddress,
};

const receive: OnchainTransferRequest = {
  v: 1,
  type: "request",
  transferId,
  direction: "receive",
  amount: 100_000,
  feeBasisPoints: 100,
  refund: { to: "sender" },
  paymentRequest: userRequest({}),
};

const denyReason = (
  request: OnchainTransferRequest,
  overrides: Partial<OperatorProfile> | null = {},
) =>
  requestDenyReason({
    request,
    profile: overrides === null ? null : { ...profile, ...overrides },
    network: "regtest",
    mintUrl: mint,
  });

describe("requestDenyReason", () => {
  it("leaves a request the operator can take to the operator", () => {
    expect(denyReason(send)).toBeNull();
    expect(denyReason(receive)).toBeNull();
    expect(
      denyReason({
        ...receive,
        refund: { to: "address", address: payoutAddress },
      }),
    ).toBeNull();
  });

  it("denies while there is no profile or transfers are paused", () => {
    expect(denyReason(send, null)).toMatch(/does not take transfers/u);
    expect(denyReason(send, { paused: true })).toMatch(/paused/u);
  });

  it("denies an amount outside the buckets and a fee other than the current one", () => {
    expect(denyReason({ ...send, amount: 123_456 })).toMatch(
      /not one of the offered amounts/u,
    );
    expect(denyReason(send, { feeBasisPoints: 150 })).toMatch(
      /fee is now 1.5 %/u,
    );
  });

  it("denies addresses of another network", () => {
    const mainnet = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
    expect(denyReason({ ...send, payoutAddress: mainnet })).toMatch(
      /payout address/u,
    );
    expect(
      denyReason({
        ...receive,
        refund: { to: "address", address: mainnet },
      }),
    ).toMatch(/refund address/u);
  });

  it("denies a payment request the payout cannot pay", () => {
    const withRequest = (paymentRequest: string) =>
      denyReason({ ...receive, paymentRequest });
    expect(withRequest("creqAnonsense")).toMatch(/does not decode/u);
    expect(
      withRequest(userRequest({ id: createId<"OnchainTransfer">() })),
    ).toMatch(/does not name this transfer/u);
    expect(withRequest(userRequest({ amount: 99_000 }))).toMatch(
      /must ask for 100000 sat/u,
    );
    expect(withRequest(userRequest({ amount: 101_000 }))).toMatch(
      /must ask for 100000 sat/u,
    );
    expect(
      withRequest(userRequest({ mints: ["https://mint.example"] })),
    ).toMatch(/payable at/u);
    expect(withRequest(userRequest({ mints: [`${mint}/`] }))).toBeNull();
  });
});

const transferOf = (
  overrides: Partial<OperatorTransfer> = {},
): OperatorTransfer => ({
  id: transferId,
  createdAtSec: 1_700_000_000,
  user,
  direction: "receive",
  amount: 100_000,
  feeBasisPoints: 100,
  payoutAddress: null,
  refund: { to: "sender" },
  userPaymentRequest: null,
  operatorPaymentRequest: null,
  depositAddress: payoutAddress,
  addressIndex: 0,
  update: null,
  userCancelledAtSec: null,
  ...overrides,
});

const updateOf = (
  overrides: Partial<OnchainTransferUpdate>,
): OnchainTransferUpdate => ({
  v: 1,
  type: "update",
  transferId,
  revision: 1,
  status: "accepted",
  fee: 1_000,
  sendAmount: 101_000,
  ...overrides,
});

describe("nextAddressIndex", () => {
  it("starts at 0 and takes one past the highest stored index", () => {
    expect(nextAddressIndex([])).toBe(0);
    expect(nextAddressIndex([{ addressIndex: null }])).toBe(0);
    expect(
      nextAddressIndex([
        { addressIndex: 3 },
        { addressIndex: null },
        { addressIndex: 1 },
      ]),
    ).toBe(4);
  });
});

const txOf = (
  outputs: readonly (readonly [string, number])[],
): EsploraTransaction => ({
  txid: "ef".repeat(32),
  vout: outputs.map(([address, value]) => ({
    scriptpubkey_address: address,
    value,
  })),
  status: { confirmed: true, block_height: 100 },
});

describe("firstUnusedAddressIndex", () => {
  const addressAt = (index: number) => `address-${index}`;
  const used = (indexes: readonly number[]) => ({
    addressTransactions: (address: string) =>
      Effect.succeed(
        indexes.map(addressAt).includes(address) ? [txOf([])] : [],
      ),
  });

  it("takes the first index from the stored one whose address has no history", async () => {
    const scan = (from: number, indexes: readonly number[]) =>
      Effect.runPromise(
        firstUnusedAddressIndex(from, addressAt, used(indexes)),
      );
    expect(await scan(0, [])).toBe(0);
    expect(await scan(0, [0, 1, 3])).toBe(2);
    expect(await scan(5, [5])).toBe(6);
  });

  it("fails when Esplora cannot tell, and gives up after 1000 used addresses", async () => {
    const failing = {
      addressTransactions: () =>
        Effect.fail(new EsploraError({ url: "", message: "offline" })),
    };
    await expect(
      Effect.runPromise(firstUnusedAddressIndex(0, addressAt, failing)),
    ).rejects.toThrow();
    const allUsed = { addressTransactions: () => Effect.succeed([txOf([])]) };
    expect(
      await Effect.runPromise(firstUnusedAddressIndex(0, addressAt, allUsed)),
    ).toBeNull();
  });
});

describe("nextUpdate", () => {
  it("numbers the first update 1 and locks the requested fee", () => {
    expect(
      nextUpdate(transferOf(), "accepted", { depositAddress: payoutAddress }),
    ).toEqual(updateOf({ depositAddress: payoutAddress }));
  });

  it("carries the whole state forward with one revision more", () => {
    const transfer = transferOf({
      feeBasisPoints: 500,
      update: updateOf({
        revision: 3,
        status: "fundsSeen",
        depositAddress: payoutAddress,
        txid: "ab".repeat(32),
        confirmations: 1,
        receivedAmount: 100_000,
      }),
    });
    expect(nextUpdate(transfer, "fundsReceived", { confirmations: 2 })).toEqual(
      updateOf({
        revision: 4,
        status: "fundsReceived",
        depositAddress: payoutAddress,
        txid: "ab".repeat(32),
        confirmations: 2,
        receivedAmount: 100_000,
      }),
    );
  });

  it("repeats the operator's payment request and drops the previous reason", () => {
    const transfer = transferOf({
      direction: "send",
      operatorPaymentRequest: "creqAoperator",
      update: updateOf({ reason: "earlier" }),
    });
    const next = nextUpdate(transfer, "fundsReceived", {
      receivedAmount: 100_000,
    });
    expect(next).toMatchObject({
      paymentRequest: "creqAoperator",
      revision: 2,
    });
    expect(next).not.toHaveProperty("reason");
  });

  it("refuses a move the status rules forbid", () => {
    expect(nextUpdate(transferOf(), "completed")).toBeNull();
    expect(
      nextUpdate(
        transferOf({ update: updateOf({ status: "denied" }) }),
        "accepted",
      ),
    ).toBeNull();
    expect(
      nextUpdate(
        transferOf({ update: updateOf({ status: "fundsReceived" }) }),
        "cancelled",
      ),
    ).toBeNull();
  });
});

describe("depositProgress", () => {
  const accepted = transferOf({ update: updateOf({ status: "accepted" }) });
  const deposit = (confirmations: number, receivedSat = 101_000) => ({
    receivedSat,
    confirmations,
    txids: ["cd".repeat(32)],
  });

  it("reports nothing before a deposit arrives", () => {
    expect(
      depositProgress(accepted, {
        receivedSat: 0,
        confirmations: 0,
        txids: [],
      }),
    ).toBeNull();
  });

  it("reports a deposit in the mempool or short of the confirmations as seen", () => {
    expect(depositProgress(accepted, deposit(0))).toEqual({
      status: "fundsSeen",
      txid: "cd".repeat(32),
      confirmations: 0,
      receivedAmount: 101_000,
    });
    expect(depositProgress(accepted, deposit(1))?.status).toBe("fundsSeen");
  });

  it("reports the deposit received at the required confirmations, also straight from accepted", () => {
    expect(depositProgress(accepted, deposit(2))?.status).toBe("fundsReceived");
  });

  it("repeats a seen deposit only when something changed", () => {
    const seen = transferOf({
      update: updateOf({
        status: "fundsSeen",
        txid: "cd".repeat(32),
        confirmations: 1,
        receivedAmount: 101_000,
      }),
    });
    expect(depositProgress(seen, deposit(1))).toBeNull();
    expect(depositProgress(seen, deposit(1, 150_000))?.receivedAmount).toBe(
      150_000,
    );
    expect(depositProgress(seen, deposit(3))).toMatchObject({
      status: "fundsReceived",
      confirmations: 2,
    });
  });

  it("keeps a confirmed deposit short of the amount plus the fee seen, and stops repeating it", () => {
    const short = depositProgress(accepted, deposit(2, 50_000));
    expect(short).toEqual({
      status: "fundsSeen",
      txid: "cd".repeat(32),
      confirmations: 2,
      receivedAmount: 50_000,
    });
    const seen = transferOf({
      update: updateOf({
        status: "fundsSeen",
        txid: "cd".repeat(32),
        ...short,
      }),
    });
    expect(depositProgress(seen, deposit(6, 50_000))).toBeNull();
    expect(depositProgress(seen, deposit(2, 101_000))?.status).toBe(
      "fundsReceived",
    );
  });

  it("tells when a deposit first reaches the required confirmations", () => {
    const progress = depositProgress(accepted, deposit(2, 50_000));
    if (progress === null) throw new Error("no progress");
    expect(isDepositNewlyConfirmed(accepted, progress)).toBe(true);
    const confirmed = transferOf({
      update: updateOf({ status: "fundsSeen", confirmations: 2 }),
    });
    expect(isDepositNewlyConfirmed(confirmed, progress)).toBe(false);
    expect(
      isDepositNewlyConfirmed(accepted, { ...progress, confirmations: 1 }),
    ).toBe(false);
  });

  it("ignores on-chain sends and transfers past the deposit", () => {
    expect(
      depositProgress(
        transferOf({ ...accepted, direction: "send" }),
        deposit(2),
      ),
    ).toBeNull();
    expect(
      depositProgress(
        transferOf({ update: updateOf({ status: "fundsReceived" }) }),
        deposit(5),
      ),
    ).toBeNull();
  });
});

describe("receivedMismatch", () => {
  it("compares what arrived with the amount plus the fee", () => {
    expect(receivedMismatch(transferOf())).toBeNull();
    const received = (receivedAmount: number) =>
      receivedMismatch(transferOf({ update: updateOf({ receivedAmount }) }));
    expect(received(100_000)).toBe("short");
    expect(received(101_000)).toBe("exact");
    expect(received(101_001)).toBe("extra");
  });
  const terminalStatuses: readonly OnchainTransferUpdate["status"][] = [
    "refunded",
    "cancelled",
    "completed",
  ];
  it.each(terminalStatuses)(
    "does not ask the operator to settle a %s transfer again",
    (status) => {
      expect(
        receivedMismatch(
          transferOf({ update: updateOf({ status, receivedAmount: 90_000 }) }),
        ),
      ).toBeNull();
    },
  );
});

describe("checkPayout", () => {
  const tx = {
    txid: "ef".repeat(32),
    vout: [
      { scriptpubkey_address: payoutAddress, value: 60_000 },
      { scriptpubkey_address: "bcrt1qother", value: 500_000 },
      { scriptpubkey_address: payoutAddress, value: 39_000 },
    ],
    status: { confirmed: false },
  };

  it("sums every output paying the payout address", () => {
    expect(checkPayout(tx, payoutAddress, 99_000)).toEqual({
      ok: true,
      paid: 99_000,
    });
    expect(checkPayout(tx, payoutAddress, 99_001)).toEqual({
      ok: false,
      paid: 99_000,
    });
  });

  it("matches a payout address the user wrote in uppercase", () => {
    expect(checkPayout(tx, payoutAddress.toUpperCase(), 99_000)).toEqual({
      ok: true,
      paid: 99_000,
    });
  });
});

describe("ecashRefundAmount", () => {
  it("returns what arrived, or the amount plus the fee", () => {
    expect(ecashRefundAmount(transferOf())).toBe(101_000);
    expect(
      ecashRefundAmount(
        transferOf({ update: updateOf({ receivedAmount: 102_000 }) }),
      ),
    ).toBe(102_000);
  });
});

describe("refundPaid", () => {
  const sender = "bcrt1qsender";
  const refundAddress = "bcrt1qrefund";
  const deposit: EsploraTransaction = {
    ...txOf([[payoutAddress, 50_000]]),
    vin: [
      { prevout: { scriptpubkey_address: sender } },
      { prevout: { scriptpubkey_address: sender } },
      { prevout: null },
    ],
  };
  const unrelated: EsploraTransaction = {
    ...txOf([["bcrt1qelsewhere", 1]]),
    vin: [{ prevout: { scriptpubkey_address: refundAddress } }],
  };
  const refundTx = txOf([
    [sender, 49_000],
    [refundAddress, 48_000],
    ["bcrt1qchange", 10_000],
  ]);

  it("sums what the refund pays the addresses the deposit came from", () => {
    expect(refundPaid(transferOf(), refundTx, [deposit, unrelated])).toBe(
      49_000,
    );
    expect(
      refundPaid(transferOf({ depositAddress: null }), refundTx, [deposit]),
    ).toBe(0);
  });

  it("sums what the refund pays a custom refund address", () => {
    expect(
      refundPaid(
        transferOf({ refund: { to: "address", address: refundAddress } }),
        refundTx,
        [],
      ),
    ).toBe(48_000);
  });
});

describe("isTransferEcash", () => {
  it("takes only sats at the transfer mint, however its url is written", () => {
    expect(isTransferEcash({ mint, unit: "sat" }, mint)).toBe(true);
    expect(isTransferEcash({ mint: `${mint}/`, unit: "sat" }, mint)).toBe(true);
    expect(
      isTransferEcash({ mint: "https://other.mint", unit: "sat" }, mint),
    ).toBe(false);
    expect(isTransferEcash({ mint, unit: "usd" }, mint)).toBe(false);
    expect(isTransferEcash({ mint: null, unit: "sat" }, mint)).toBe(false);
  });
});

describe("isTxidOfAnotherTransfer", () => {
  const txid = "ab".repeat(32);
  const other = createId<"OnchainTransfer">();

  it("finds the transaction on another transfer's payout or refund only", () => {
    const paid = transferOf({
      id: other,
      update: updateOf({ status: "completed", txid }),
    });
    const refunded = transferOf({
      id: other,
      update: updateOf({ status: "refunded", refundTxid: txid }),
    });
    expect(isTxidOfAnotherTransfer([paid], transferId, txid)).toBe(true);
    expect(isTxidOfAnotherTransfer([refunded], transferId, txid)).toBe(true);
    expect(isTxidOfAnotherTransfer([paid], other, txid)).toBe(false);
    expect(isTxidOfAnotherTransfer([paid], transferId, "cd".repeat(32))).toBe(
      false,
    );
  });
});

describe("sharedDepositAddresses", () => {
  it("lists the deposit addresses more than one transfer holds", () => {
    const at = (depositAddress: string | null) =>
      transferOf({ id: createId<"OnchainTransfer">(), depositAddress });
    expect([
      ...sharedDepositAddresses([
        at("a"),
        at("b"),
        at("a"),
        at(null),
        at(null),
      ]),
    ]).toEqual(["a"]);
  });
});
