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
import type { AppDataEvent, Pubkey } from "@linky-fit/linkstr";
import {
  canonicalBitcoinAddress,
  decodeOnchainConfig,
  decodeTransferUpdateColumn,
  encodeTransferUpdateColumn,
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
  parseCashuPaymentRequestMessage,
  type CashuPaymentRequestMessageInfo,
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
  /** Sats the user gets. */
  readonly amount: number;
  /** The fee the operator locked, or the one the request was made at until it answers. */
  readonly fee: number;
  /** The amount plus the fee. */
  readonly sendAmount: number;
  readonly phase: OnchainTransferPhase;
  readonly update: OnchainTransferUpdate | null;
  readonly payoutAddress: string | null;
  readonly refundAddress: string | null;
  readonly refundToSender: boolean;
  readonly depositAddress: string | null;
  readonly operatorPaymentRequest: string | null;
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

/** Whether the request the user made for an on-chain receive received its own amount. */
const isUserRequestPaid = (
  userPaymentRequest: string | null,
  received: ReceivedSatByRequestId,
): boolean => {
  if (userPaymentRequest === null) return false;
  const request = parseCashuPaymentRequestMessage(userPaymentRequest);
  return (
    request !== null &&
    request.requestId !== null &&
    request.amount !== null &&
    isRequestPaidInFull(received, request.requestId, request.amount)
  );
};

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
  return {
    id: record.id,
    createdAtSec: record.createdAtSec,
    direction,
    amount: record.amount,
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
        isUserRequestPaid(record.userPaymentRequest, history.received),
    }),
    update,
    payoutAddress: record.payoutAddress,
    refundAddress: record.refundAddress,
    refundToSender: record.refundToSender === sqliteTrue,
    depositAddress: record.depositAddress,
    operatorPaymentRequest: record.operatorPaymentRequest,
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

export interface NewOnchainTransferDraft {
  readonly direction: OnchainTransferDirection;
  readonly amount: number | null;
  readonly payoutAddress: string;
  readonly refundAddress: string;
  readonly refundToSender: boolean;
}

export type NewOnchainTransferProblem =
  | "paused"
  | "amountMissing"
  | "payoutAddressMissing"
  | "payoutAddressInvalid"
  | "refundMissing"
  | "refundAddressInvalid";

/** Why the draft cannot be requested under `config` yet; null when it can. */
export const newOnchainTransferProblem = (
  draft: NewOnchainTransferDraft,
  config: OnchainConfig,
): NewOnchainTransferProblem | null => {
  if (config.paused) return "paused";
  if (draft.amount === null || !config.amounts.includes(draft.amount)) {
    return "amountMissing";
  }
  if (draft.direction === "send") {
    const address = draft.payoutAddress.trim();
    if (address === "") return "payoutAddressMissing";
    return isValidBitcoinAddress(address, config.network)
      ? null
      : "payoutAddressInvalid";
  }
  if (draft.refundToSender) return null;
  const refundAddress = draft.refundAddress.trim();
  if (refundAddress === "") return "refundMissing";
  return isValidBitcoinAddress(refundAddress, config.network)
    ? null
    : "refundAddressInvalid";
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
 * An on-chain receive needs the user's payment request for the amount;
 * null when the parts do not fit the message or the row.
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
  if (draft.amount === null) return null;
  const send = draft.direction === "send";
  // The operator's chain watcher matches addresses as Esplora reports them; "" fails the request schema.
  const canonical = (address: string) =>
    canonicalBitcoinAddress(address.trim(), config.network) ?? "";
  const payoutAddress = canonical(draft.payoutAddress);
  const refundAddress = canonical(draft.refundAddress);
  const request: OnchainTransferRequest = {
    v: 1,
    type: "request",
    transferId: id,
    direction: draft.direction,
    amount: draft.amount,
    feeBasisPoints: config.feeBasisPoints,
    ...(send
      ? { payoutAddress }
      : {
          refund: draft.refundToSender
            ? { to: "sender" }
            : { to: "address", address: refundAddress },
          ...(userPaymentRequest === null
            ? {}
            : { paymentRequest: userPaymentRequest }),
        }),
  };
  if (!isOnchainTransferRequest(request)) return null;
  const createdAtSec = PositiveInt.from(nowSec);
  const amount = PositiveInt.from(draft.amount);
  const feeBasisPoints = NonNegativeInt.from(config.feeBasisPoints);
  if (!createdAtSec.ok || !amount.ok || !feeBasisPoints.ok) return null;
  const payout = send ? textColumn(payoutAddress) : null;
  const refund =
    send || draft.refundToSender ? null : textColumn(refundAddress);
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
      ...(refund === null ? {} : { refundAddress: refund }),
      ...(!send && draft.refundToSender ? { refundToSender: sqliteTrue } : {}),
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

/** Whether the operator's request asks for exactly this transfer: its id, its amount plus the fee, paid to the operator. */
export const isOperatorRequestFor = (
  request: CashuPaymentRequestMessageInfo,
  transfer: Pick<OnchainTransferView, "id" | "sendAmount">,
  operator: Pubkey,
): boolean =>
  sameText(request.requestId, transfer.id) &&
  request.amount === transfer.sendAmount &&
  request.preferredTransport === "nostr" &&
  request.transportPubkeyHex === operator;

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
