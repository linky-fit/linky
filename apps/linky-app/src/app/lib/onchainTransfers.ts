import {
  parseBip321Uri,
  PaymentRequestId,
} from "@linky-fit/linkshu/payment-request";
import {
  NonEmptyString100,
  NonEmptyString1000,
  NonNegativeInt,
  PositiveInt,
  sqliteTrue,
  type OnchainTransferRecord,
  type OnchainTransfersRepository,
  type OnchainTransferId,
} from "@linky-fit/linksync";
import {
  encodeNprofile,
  type AppDataEvent,
  type Pubkey,
} from "@linky-fit/linkstr";
import {
  canonicalBitcoinAddress,
  decodeOnchainConfig,
  decodeTransferUpdateColumn,
  encodeTransferUpdateColumn,
  isOfferedAmount,
  isValidBitcoinAddress,
  newerTransferUpdate,
  serviceFee,
  OnchainTransferDirection,
  amountWithServiceFee,
  OnchainTransferRequest,
  onchainTransferPhase,
  type BitcoinNetwork,
  type OnchainConfig,
  type OnchainTransferUpdate,
  type OnchainTransferPhase,
} from "@linky-fit/onchain-transfer";
import { Option, Schema } from "effect";
import {
  buildCashuPaymentRequestMessage,
  parseCashuPaymentRequestMessage,
} from "./paymentRequestMessage";
import {
  isRequestPaidInFull,
  type PaidAtSecByRequestId,
  type ReceivedSatByRequestId,
} from "./paymentRequestStatus";

/** One of the user's transfers as the transfer screens and the operator chat show it. */
export interface OnchainTransferView {
  readonly id: OnchainTransferId;
  readonly createdAtSec: number;
  readonly direction: OnchainTransferDirection;
  /** Sats the user gets: what the newest update's terms leave after the fee, the request's amount before any update. */
  readonly amount: number;
  /** The fee the operator locked, or the one the request was made at until it answers. */
  readonly fee: number;
  /** The amount plus the fee. */
  readonly sendAmount: number;
  readonly phase: OnchainTransferPhase;
  readonly update: OnchainTransferUpdate | null;
  readonly payoutAddress: string | null;
  readonly depositAddress: string | null;
  readonly operatorPaymentRequest: string | null;
  /** receive: for whatever the user deposits within the operator's limits; the deposit sets the amounts, which mean nothing before it. */
  readonly anyAmount: boolean;
}

const isOnchainTransferDirection = Schema.is(OnchainTransferDirection);

/** Compares ids of different brands, e.g. a transfer id with the request id it doubles as. */
const sameText = (a: string | null, b: string): boolean => a === b;

interface OnchainTransferSides {
  readonly role: string | null;
  readonly peerPubkey: string | null;
}

const isUserOnchainTransferWith = (
  row: OnchainTransferSides,
  operator: Pubkey,
): boolean => row.role === "user" && sameText(row.peerPubkey, operator);

/** What the payment history paid and received per request id. */
export interface OnchainTransferPaymentHistory {
  readonly paidAtSec: PaidAtSecByRequestId;
  readonly received: ReceivedSatByRequestId;
}

/** Whether the request the user made for an on-chain receive received its own amount, or `termsAmount`, what the deposit's terms give, when it names none. */
const isUserRequestPaid = (
  userPaymentRequest: string | null,
  received: ReceivedSatByRequestId,
  termsAmount: number,
): boolean => {
  if (userPaymentRequest === null) return false;
  const request = parseCashuPaymentRequestMessage(userPaymentRequest);
  return (
    request !== null &&
    request.requestId !== null &&
    isRequestPaidInFull(
      received,
      request.requestId,
      request.amount ?? termsAmount,
    )
  );
};

/** A receive whose own payment request names no amount leaves the amount to the deposit. */
const isAnyAmountReceive = (
  direction: OnchainTransferDirection,
  userPaymentRequest: string | null,
): boolean =>
  direction === "receive" &&
  userPaymentRequest !== null &&
  parseCashuPaymentRequestMessage(userPaymentRequest)?.amount === null;

/** The view of a transfer this account requested from `operator`; null for any other row. */
export const onchainTransferView = (
  record: OnchainTransferRecord,
  operator: Pubkey,
  history: OnchainTransferPaymentHistory,
): OnchainTransferView | null => {
  const { direction } = record;
  if (!isUserOnchainTransferWith(record, operator)) return null;
  if (!isOnchainTransferDirection(direction)) return null;
  const update = decodeTransferUpdateColumn(record.updateJson);
  const fee = update?.fee ?? serviceFee(record.amount, record.feeBasisPoints);
  const sendAmount =
    update?.sendAmount ??
    amountWithServiceFee(record.amount, record.feeBasisPoints);
  const amount = update === null ? record.amount : sendAmount - fee;
  return {
    id: record.id,
    createdAtSec: record.createdAtSec,
    direction,
    amount,
    fee,
    sendAmount,
    phase: onchainTransferPhase({
      direction,
      update,
      userCancelledAtSec: record.cancelledAtSec,
      // The history also holds a payment whose `sentAtSec` write was lost.
      sentAtSec:
        record.sentAtSec ??
        history.paidAtSec.get(PaymentRequestId.make(record.id)) ??
        null,
      requestPaid:
        direction === "receive" &&
        isUserRequestPaid(record.userPaymentRequest, history.received, amount),
    }),
    update,
    payoutAddress: record.payoutAddress,
    depositAddress: record.depositAddress,
    operatorPaymentRequest: record.operatorPaymentRequest,
    anyAmount: isAnyAmountReceive(direction, record.userPaymentRequest),
  };
};

const FINISHED_PHASES: ReadonlySet<OnchainTransferPhase> = new Set([
  "completed",
  "denied",
  "cancelled",
  "refunded",
]);

export const isFinishedOnchainTransferPhase = (
  phase: OnchainTransferPhase,
): boolean => FINISHED_PHASES.has(phase);

/** The transfers still running, newest first. */
export const unfinishedOnchainTransfers = (
  transfers: readonly OnchainTransferView[],
): readonly OnchainTransferView[] =>
  transfers
    .filter((transfer) => !isFinishedOnchainTransferPhase(transfer.phase))
    .sort(
      (a, b) => b.createdAtSec - a.createdAtSec || b.id.localeCompare(a.id),
    );

/** The newest receive of any amount still waiting for a deposit, whose address the receive screen shows again; null when none. */
export const openOnchainReceive = (
  transfers: readonly OnchainTransferView[],
): OnchainTransferView | null =>
  unfinishedOnchainTransfers(transfers).find(
    (transfer) =>
      transfer.direction === "receive" &&
      transfer.anyAmount &&
      (transfer.phase === "waitingForDetails" ||
        transfer.phase === "awaitingDeposit"),
  ) ?? null;

/** send: whether the user still owes the operator the payment. */
export const isOnchainSendUnpaid = (
  transfer: Pick<OnchainTransferView, "direction" | "phase">,
): boolean =>
  transfer.direction === "send" &&
  (transfer.phase === "waitingForDetails" || transfer.phase === "readyToSend");

export interface NewOnchainTransferDraft {
  readonly direction: OnchainTransferDirection;
  /** send: one of the config's amounts; receive: null, for any amount. */
  readonly amount: number | null;
  readonly payoutAddress: string;
}

export type NewOnchainTransferProblem =
  | "paused"
  | "amountMissing"
  /** receive: the operator takes no receive of any amount. */
  | "anyAmountUnavailable"
  | "payoutAddressMissing"
  | "payoutAddressInvalid";

/** Why the draft cannot be requested under `config` yet; null when it can. */
export const newOnchainTransferProblem = (
  draft: NewOnchainTransferDraft,
  config: OnchainConfig,
): NewOnchainTransferProblem | null => {
  if (config.paused) return "paused";
  if (draft.direction === "receive") {
    return isOfferedAmount(config, "receive", null)
      ? null
      : "anyAmountUnavailable";
  }
  if (draft.amount === null || !isOfferedAmount(config, "send", draft.amount))
    return "amountMissing";
  const address = draft.payoutAddress.trim();
  if (address === "") return "payoutAddressMissing";
  return isValidBitcoinAddress(address, config.network)
    ? null
    : "payoutAddressInvalid";
};

export interface PlannedOnchainTransfer {
  readonly request: OnchainTransferRequest;
  readonly row: Parameters<OnchainTransfersRepository["insert"]>[0];
}

const isOnchainTransferRequest = Schema.is(OnchainTransferRequest);

const textColumn = (value: string | null): NonEmptyString1000 | null => {
  const parsed = NonEmptyString1000.from(value ?? "");
  return parsed.ok ? parsed.value : null;
};

/**
 * The request message and the row of a valid draft (see `newOnchainTransferProblem`).
 * An on-chain receive needs the user's payment request, one naming no amount;
 * its row holds the config's minimum until the deposit sets the terms.
 * Null when the parts do not fit the message or the row.
 */
export const planOnchainTransfer = ({
  draft,
  config,
  id,
  nowSec,
  operator,
  userPaymentRequest,
}: {
  readonly draft: NewOnchainTransferDraft;
  readonly config: OnchainConfig;
  readonly id: OnchainTransferId;
  readonly nowSec: number;
  readonly operator: Pubkey;
  readonly userPaymentRequest: string | null;
}): PlannedOnchainTransfer | null => {
  const send = draft.direction === "send";
  const rowAmount = send ? draft.amount : (config.minReceiveAmount ?? null);
  if (rowAmount === null) return null;
  // The operator's chain watcher matches addresses as Esplora reports them; "" fails the request schema.
  const payoutAddress =
    canonicalBitcoinAddress(draft.payoutAddress.trim(), config.network) ?? "";
  const request: OnchainTransferRequest = {
    v: 1,
    type: "request",
    transferId: id,
    direction: draft.direction,
    ...(draft.amount === null ? {} : { amount: draft.amount }),
    feeBasisPoints: config.feeBasisPoints,
    ...(send
      ? { payoutAddress }
      : {
          refund: { to: "sender" },
          ...(userPaymentRequest === null
            ? {}
            : { paymentRequest: userPaymentRequest }),
        }),
  };
  if (!isOnchainTransferRequest(request)) return null;
  const createdAtSec = PositiveInt.from(nowSec);
  const amount = PositiveInt.from(rowAmount);
  const feeBasisPoints = NonNegativeInt.from(config.feeBasisPoints);
  if (!createdAtSec.ok || !amount.ok || !feeBasisPoints.ok) return null;
  const payout = send ? textColumn(payoutAddress) : null;
  const userRequest = send ? null : textColumn(userPaymentRequest);
  return {
    request,
    row: {
      id,
      createdAtSec: createdAtSec.value,
      role: NonEmptyString100.orThrow("user"),
      peerPubkey: NonEmptyString100.orThrow(operator),
      direction: NonEmptyString100.orThrow(draft.direction),
      amount: amount.value,
      feeBasisPoints: feeBasisPoints.value,
      ...(payout === null ? {} : { payoutAddress: payout }),
      ...(send ? {} : { refundToSender: sqliteTrue }),
      ...(userRequest === null ? {} : { userPaymentRequest: userRequest }),
    },
  };
};

export interface OnchainTransferUpdatePatch {
  readonly updateJson: NonEmptyString1000;
  readonly depositAddress?: NonEmptyString1000;
  readonly operatorPaymentRequest?: NonEmptyString1000;
}

/**
 * What an update from the operator changes on the user's row: nothing for
 * a row of another peer or role, or an update no newer than the stored one.
 */
export const onchainTransferUpdatePatch = (
  row: OnchainTransferSides & { readonly updateJson: string | null },
  operator: Pubkey,
  update: OnchainTransferUpdate,
): OnchainTransferUpdatePatch | null => {
  if (!isUserOnchainTransferWith(row, operator)) return null;
  const current = decodeTransferUpdateColumn(row.updateJson);
  if (newerTransferUpdate(current, update) !== update) return null;
  const updateJson = NonEmptyString1000.from(
    encodeTransferUpdateColumn(update),
  );
  if (!updateJson.ok) return null;
  const depositAddress = textColumn(update.depositAddress ?? null);
  const paymentRequest = textColumn(update.paymentRequest ?? null);
  return {
    updateJson: updateJson.value,
    ...(depositAddress === null ? {} : { depositAddress }),
    ...(paymentRequest === null
      ? {}
      : { operatorPaymentRequest: paymentRequest }),
  };
};

/** The operator's newest readable config among fetched events; a config by anyone else means nothing. */
export const newestOnchainConfig = (
  events: readonly AppDataEvent[],
  operator: Pubkey,
): OnchainConfig | null => {
  const newestFirst = [...events].sort((a, b) => b.createdAt - a.createdAt);
  for (const event of newestFirst) {
    if (event.author !== operator) continue;
    const config = decodeOnchainConfig(event);
    if (Option.isSome(config)) return config.value;
  }
  return null;
};

/**
 * The NUT-18 request Linky pays for an on-chain send, built here so the
 * payment leaves right after the request: the amount plus the fee at the
 * config's mint, to the operator over Nostr, with the transfer id as the
 * request id, which is how the operator matches the ecash to the transfer.
 */
export const onchainSendPaymentRequest = (
  transfer: Pick<OnchainTransferView, "id" | "sendAmount">,
  mintUrl: string,
  operator: Pubkey,
): string =>
  buildCashuPaymentRequestMessage({
    amount: transfer.sendAmount,
    mintUrls: [mintUrl],
    recipientNprofile: encodeNprofile(operator, []),
    requestId: PaymentRequestId.make(transfer.id),
  });

/** Signet addresses are testnet's. */
const ADDRESS_NETWORKS: readonly BitcoinNetwork[] = [
  "mainnet",
  "testnet",
  "regtest",
];

/**
 * The bitcoin address a scanned or pasted text pays, bare or in a BIP21 URI,
 * with the URI's amount; null for anything else. The address may be of any
 * network: the on-chain send screen tells the user when it is not the config's.
 */
export const onchainPayoutTarget = (
  text: string,
): { readonly address: string; readonly amountSat: number | null } | null => {
  const uri = parseBip321Uri(text);
  const address = uri === null ? text.trim() : uri.address;
  if (
    address === null ||
    !ADDRESS_NETWORKS.some((network) => isValidBitcoinAddress(address, network))
  ) {
    return null;
  }
  return { address, amountSat: uri?.amountSat ?? null };
};
