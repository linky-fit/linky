import { decodePaymentRequest } from "@linky-fit/linkshu";
import {
  canOperatorMove,
  paysAddress,
  REQUIRED_CONFIRMATIONS,
  isValidBitcoinAddress,
  type BitcoinNetwork,
  type DepositStatus,
  type EsploraClient,
  type EsploraError,
  type EsploraTransaction,
  type OperatorTransferStatus,
  type OnchainTransferRequest,
  type OnchainTransferUpdate,
} from "@linky-fit/onchain-transfer";
import { Effect, Struct } from "effect";
import type { OperatorProfile } from "./profile";
import {
  isOpen,
  transferStatus,
  transferTerms,
  type OperatorTransfer,
} from "./transfer";

const normalizeMint = (mint: string) =>
  mint.trim().replace(/\/+$/u, "").toLowerCase();

/** Whether ecash at `mint` in `unit` can pay a transfer: only sats at the transfer mint can. */
export const isTransferEcash = (
  ecash: { readonly mint: string | null; readonly unit: string | null },
  mintUrl: string,
): boolean =>
  ecash.mint !== null &&
  normalizeMint(ecash.mint) === normalizeMint(mintUrl) &&
  ecash.unit === "sat";

const sats = (amount: number) => `${amount} sat`;

/** Why the user's payment request cannot be paid as the transfer's payout; `null` when it can. */
const paymentRequestProblem = (
  request: OnchainTransferRequest,
  paymentRequest: string,
  mintUrl: string,
): string | null => {
  const decoded = decodePaymentRequest(paymentRequest);
  if (decoded === null) return "The payment request does not decode.";
  const requestId: string | null = decoded.id;
  if (requestId !== request.transferId)
    return "The payment request does not name this transfer.";
  if (decoded.amount !== request.amount || (decoded.unit ?? "sat") !== "sat")
    return `The payment request must ask for ${sats(request.amount)}.`;
  if (
    !decoded.mints.some(
      (mint) => normalizeMint(mint) === normalizeMint(mintUrl),
    )
  )
    return `The payment request must be payable at ${mintUrl}.`;
  if (!decoded.transports.some((transport) => transport.type === "nostr"))
    return "The payment request has no Nostr transport.";
  if (decoded.lock !== null)
    return "The payment request must not lock the Cashu.";
  return null;
};

/**
 * Why a request is denied on arrival, as the reason the user reads; `null`
 * when the operator decides by hand.
 */
export const requestDenyReason = (args: {
  readonly request: OnchainTransferRequest;
  readonly profile: OperatorProfile | null;
  readonly network: BitcoinNetwork;
  readonly mintUrl: string;
}): string | null => {
  const { request, profile, network } = args;
  if (profile === null) return "The operator does not take transfers yet.";
  if (profile.paused) return "Transfers are paused.";
  if (!profile.amounts.includes(request.amount))
    return `${sats(request.amount)} is not one of the offered amounts.`;
  if (request.feeBasisPoints !== profile.feeBasisPoints)
    return `The fee is now ${profile.feeBasisPoints / 100} %; request the transfer again.`;
  if (
    request.payoutAddress !== undefined &&
    !isValidBitcoinAddress(request.payoutAddress, network)
  )
    return `The payout address is not a ${network} address.`;
  if (
    request.refund?.to === "address" &&
    !isValidBitcoinAddress(request.refund.address, network)
  )
    return `The refund address is not a ${network} address.`;
  return request.paymentRequest === undefined
    ? null
    : paymentRequestProblem(request, request.paymentRequest, args.mintUrl);
};

/** The BIP86 receive index of the next deposit address: one past the highest used, from 0. */
export const nextAddressIndex = (
  transfers: readonly { readonly addressIndex: number | null }[],
): number =>
  transfers.reduce(
    (next, transfer) =>
      transfer.addressIndex === null
        ? next
        : Math.max(next, transfer.addressIndex + 1),
    0,
  );

const ADDRESS_SCAN_LIMIT = 1_000;

/**
 * The first receive index from `from` whose address has no on-chain history,
 * so an operator whose stored transfers were lost never hands out a used
 * deposit address; `null` when none of the next 1000 is unused.
 */
export const firstUnusedAddressIndex = (
  from: number,
  addressAt: (index: number) => string,
  esplora: Pick<EsploraClient, "addressTransactions">,
): Effect.Effect<number | null, EsploraError> =>
  Effect.gen(function* () {
    for (let index = from; index < from + ADDRESS_SCAN_LIMIT; index += 1) {
      const history = yield* esplora.addressTransactions(addressAt(index));
      if (history.length === 0) return index;
    }
    return null;
  });

/** What a new update may set besides its status. */
export type UpdateChanges = Partial<
  Pick<
    OnchainTransferUpdate,
    | "depositAddress"
    | "paymentRequest"
    | "txid"
    | "confirmations"
    | "receivedAmount"
    | "refundTxid"
    | "refundAmount"
    | "reason"
  >
>;

/**
 * The next update of the transfer: its whole state with one revision more, the
 * fee locked by the first update. `null` when the status may not follow the
 * current one.
 */
export const nextUpdate = (
  transfer: OperatorTransfer,
  status: OperatorTransferStatus,
  changes: UpdateChanges = {},
): OnchainTransferUpdate | null => {
  if (!canOperatorMove(transferStatus(transfer), status)) return null;
  return {
    // A reason explains one move; the next update does not repeat it.
    ...(transfer.update === null
      ? {}
      : Struct.omit(transfer.update, ["reason"])),
    ...(transfer.operatorPaymentRequest === null
      ? {}
      : { paymentRequest: transfer.operatorPaymentRequest }),
    ...changes,
    v: 1,
    type: "update",
    transferId: transfer.id,
    revision: (transfer.update?.revision ?? 0) + 1,
    status,
    ...transferTerms(transfer),
  };
};

/** The deposit fields an update reports. */
export interface DepositProgress {
  readonly status: "fundsSeen" | "fundsReceived";
  readonly txid: string;
  readonly confirmations: number;
  readonly receivedAmount: number;
}

/**
 * What the deposit watcher reports for an on-chain receive: `fundsSeen`
 * whenever the deposit changed, `fundsReceived` once at least the amount plus
 * the fee has the required confirmations; a short deposit stays `fundsSeen`
 * for the operator to refund. Confirmations count up to the required ones
 * only, so a confirmed short deposit is not reported again every block;
 * `null` while nothing new is there to report.
 */
export const depositProgress = (
  transfer: OperatorTransfer,
  deposit: DepositStatus,
): DepositProgress | null => {
  const current = transferStatus(transfer);
  const [txid] = deposit.txids;
  if (
    transfer.direction !== "receive" ||
    (current !== "accepted" && current !== "fundsSeen") ||
    txid === undefined ||
    deposit.receivedSat === 0
  )
    return null;
  const confirmations = Math.min(deposit.confirmations, REQUIRED_CONFIRMATIONS);
  const progress: DepositProgress = {
    status:
      confirmations === REQUIRED_CONFIRMATIONS &&
      deposit.receivedSat >= transferTerms(transfer).sendAmount
        ? "fundsReceived"
        : "fundsSeen",
    txid,
    confirmations,
    receivedAmount: deposit.receivedSat,
  };
  const unchanged =
    current === "fundsSeen" &&
    progress.status === "fundsSeen" &&
    transfer.update?.txid === progress.txid &&
    transfer.update.confirmations === progress.confirmations &&
    transfer.update.receivedAmount === progress.receivedAmount;
  return unchanged ? null : progress;
};

/** Whether the progress is the first report of the deposit at the required confirmations, which the operator acts on. */
export const isDepositNewlyConfirmed = (
  transfer: OperatorTransfer,
  progress: DepositProgress,
): boolean =>
  progress.confirmations === REQUIRED_CONFIRMATIONS &&
  (transfer.update?.confirmations ?? 0) < REQUIRED_CONFIRMATIONS;

/** An open transfer's deposit against what the user sends; `null` before funds arrive or once settled. */
export const receivedMismatch = (
  transfer: OperatorTransfer,
): "short" | "extra" | "exact" | null => {
  const received = transfer.update?.receivedAmount;
  if (received === undefined || !isOpen(transfer)) return null;
  const { sendAmount } = transferTerms(transfer);
  return received < sendAmount
    ? "short"
    : received > sendAmount
      ? "extra"
      : "exact";
};

/** Whether the payout transaction pays the address what the user gets; `paid` is what it pays there. */
export const checkPayout = (
  tx: EsploraTransaction,
  payoutAddress: string,
  amount: number,
): { readonly ok: boolean; readonly paid: number } => {
  const paid = paysAddress(tx, payoutAddress);
  return { ok: paid >= amount, paid };
};

/** The ecash an on-chain send's refund returns: what arrived, or the amount plus the fee. */
export const ecashRefundAmount = (transfer: OperatorTransfer): number =>
  transfer.update?.receivedAmount ?? transferTerms(transfer).sendAmount;

/**
 * Sats an on-chain receive's refund transaction returns: what it pays the
 * refund address, or the addresses that funded the deposit (`depositTxs`,
 * the deposit address's transactions) for a refund to the sender.
 */
export const refundPaid = (
  transfer: Pick<OperatorTransfer, "refund" | "depositAddress">,
  refundTx: EsploraTransaction,
  depositTxs: readonly EsploraTransaction[],
): number => {
  const { refund, depositAddress } = transfer;
  if (refund?.to === "address") return paysAddress(refundTx, refund.address);
  if (depositAddress === null) return 0;
  const senders = new Set(
    depositTxs
      .filter((tx) => paysAddress(tx, depositAddress) > 0)
      .flatMap((tx) => tx.vin ?? [])
      .flatMap(({ prevout }) =>
        prevout?.scriptpubkey_address === undefined
          ? []
          : [prevout.scriptpubkey_address],
      ),
  );
  return [...senders].reduce(
    (sum, sender) => sum + paysAddress(refundTx, sender),
    0,
  );
};

export const isTxid = (text: string): boolean => /^[0-9a-f]{64}$/u.test(text);

/** Whether a transfer other than `id` already carries `txid` as its deposit, payout or refund. */
export const isTxidOfAnotherTransfer = (
  transfers: readonly OperatorTransfer[],
  id: OperatorTransfer["id"],
  txid: string,
): boolean =>
  transfers.some(
    (transfer) =>
      transfer.id !== id &&
      (transfer.update?.txid === txid || transfer.update?.refundTxid === txid),
  );

/** Deposit addresses more than one transfer holds, as when two devices accepted before they synced. */
export const sharedDepositAddresses = (
  transfers: readonly OperatorTransfer[],
): ReadonlySet<string> => {
  const seen = new Set<string>();
  const shared = new Set<string>();
  for (const { depositAddress } of transfers) {
    if (depositAddress === null) continue;
    (seen.has(depositAddress) ? shared : seen).add(depositAddress);
  }
  return shared;
};
