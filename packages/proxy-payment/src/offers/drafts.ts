import {
  BankOfferDraft,
  BankOfferId,
  ClientId,
  Pubkey,
  UnixSeconds,
  type BankOfferStatus,
} from "@linky/linkstr";
import { Schema } from "effect";
import { bankPaymentOfferMessageText } from "./content";
import { bankPaymentOfferBankPaidAtSec, type BankPaymentOffer } from "./offer";
import { isOffererBankPaymentOfferStatus } from "./status";

const isPubkey = Schema.is(Pubkey);
const isBankOfferId = Schema.is(BankOfferId);
const isNonEmptyTrimmedString = Schema.is(Schema.NonEmptyTrimmedString);
const isPositiveInt = Schema.is(Schema.Int.pipe(Schema.positive()));
const isUnixSeconds = Schema.is(UnixSeconds);

const positiveInt = (value: unknown): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  const integer = Math.trunc(value);
  return isPositiveInt(integer) ? integer : undefined;
};

const positiveUnixSeconds = (value: unknown): UnixSeconds | undefined => {
  const integer = positiveInt(value);
  return integer !== undefined && isUnixSeconds(integer) ? integer : undefined;
};

export const newBankPaymentOfferClientId = (): ClientId =>
  ClientId.make(crypto.randomUUID());

export const bankPaymentOfferedDraft = (args: {
  amountSat: number | null;
  amountText: string;
  expiresAtSec?: number | null;
  offerId: BankOfferId;
  offerer: Pubkey;
  to: Pubkey;
}): BankOfferDraft | null => {
  const amountText = args.amountText.trim();
  const text = bankPaymentOfferMessageText(amountText, "offered");
  if (!isNonEmptyTrimmedString(amountText) || !isNonEmptyTrimmedString(text)) {
    return null;
  }
  const amountSat = positiveInt(args.amountSat);
  const expiresAtSec = positiveUnixSeconds(args.expiresAtSec);
  return new BankOfferDraft({
    to: args.to,
    offerId: args.offerId,
    offerer: args.offerer,
    status: "offered",
    amountText,
    text,
    ...(amountSat === undefined ? {} : { amountSat }),
    ...(expiresAtSec === undefined ? {} : { expiresAtSec }),
    clientId: newBankPaymentOfferClientId(),
  });
};

export interface BankPaymentOfferResponseOptions {
  expiresAtSec?: number | null;
  extensionSec?: number | null;
  spdPayload?: string | null;
  withPush?: boolean;
}

/** The next snapshot of a known thread, or null when `me` may not send `nextStatus` on it. */
export const bankPaymentOfferResponseDraft = (
  offer: BankPaymentOffer,
  nextStatus: BankOfferStatus,
  me: Pubkey,
  options: BankPaymentOfferResponseOptions = {},
): BankOfferDraft | null => {
  const offerer = offer.offererPublicKey;
  const to = offer.peer;
  const extensionSec = positiveInt(options.extensionSec);
  const text = bankPaymentOfferMessageText(
    offer.amountText,
    nextStatus,
    extensionSec,
  );
  if (
    !isPubkey(offerer) ||
    !isPubkey(to) ||
    to === me ||
    isOffererBankPaymentOfferStatus(nextStatus) !== (offerer === me) ||
    !isBankOfferId(offer.offerId) ||
    !isNonEmptyTrimmedString(offer.amountText) ||
    !isNonEmptyTrimmedString(text)
  ) {
    return null;
  }

  const initiatedAtSec = positiveUnixSeconds(
    offer.initiatedAtSec ?? offer.createdAtSec,
  );
  const bankPaidAtSec = positiveUnixSeconds(
    bankPaymentOfferBankPaidAtSec(offer),
  );
  const expiresAtSec = positiveUnixSeconds(options.expiresAtSec);
  const amountSat = positiveInt(offer.amountSat);
  const spdPayload = (options.spdPayload ?? offer.spdPayload ?? "").trim();
  return new BankOfferDraft({
    to,
    offerId: offer.offerId,
    offerer,
    status: nextStatus,
    amountText: offer.amountText,
    text,
    ...(amountSat === undefined ? {} : { amountSat }),
    ...(initiatedAtSec === undefined ? {} : { initiatedAtSec }),
    ...(bankPaidAtSec === undefined ? {} : { bankPaidAtSec }),
    ...(expiresAtSec === undefined ? {} : { expiresAtSec }),
    ...(extensionSec === undefined ? {} : { extensionSec }),
    ...(isNonEmptyTrimmedString(spdPayload) ? { spdPayload } : {}),
    ...(options.withPush === undefined ? {} : { pushMark: options.withPush }),
    clientId: newBankPaymentOfferClientId(),
  });
};
