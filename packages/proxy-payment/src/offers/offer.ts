import type { BankOfferStatus } from "@linky/linkstr";
import type { BankPaymentOfferInfo } from "./content";
import {
  BANK_PAYMENT_OFFER_PHASE_TTL_SEC,
  isTerminalBankPaymentOfferStatus,
} from "./status";

/** The authenticated state of one offer thread: one offer id with one peer. */
export interface BankPaymentOffer extends BankPaymentOfferInfo {
  clientId: string | null;
  /** The encoded snapshot JSON, byte for byte what the wire carried. */
  content: string;
  /** Send time of the first snapshot seen for this thread. */
  createdAtSec: number;
  offererPublicKey: string;
  peer: string;
  snapshotId: string;
}

interface OfferPhase {
  expiresAtSec: number | null;
  status: BankOfferStatus;
  statusUpdatedAtSec: number | null;
}

export const bankPaymentOfferExpiresAtSec = (
  offer: OfferPhase,
  createdAtSec: number,
): number | null => {
  if (isTerminalBankPaymentOfferStatus(offer.status)) return null;
  if (offer.expiresAtSec && offer.expiresAtSec > 0) return offer.expiresAtSec;

  const phaseStartedAtSec =
    offer.statusUpdatedAtSec && offer.statusUpdatedAtSec > 0
      ? offer.statusUpdatedAtSec
      : createdAtSec;
  if (!Number.isFinite(phaseStartedAtSec) || phaseStartedAtSec <= 0) {
    return null;
  }
  return Math.trunc(phaseStartedAtSec) + BANK_PAYMENT_OFFER_PHASE_TTL_SEC;
};

export const isBankPaymentOfferExpired = (
  offer: OfferPhase,
  createdAtSec: number,
  nowSec: number,
): boolean => {
  const expiresAtSec = bankPaymentOfferExpiresAtSec(offer, createdAtSec);
  return expiresAtSec !== null && nowSec >= expiresAtSec;
};

export const bankPaymentOfferBankPaidAtSec = (
  offer: Pick<
    BankPaymentOfferInfo,
    "bankPaidAtSec" | "status" | "statusUpdatedAtSec"
  >,
): number | null =>
  offer.bankPaidAtSec ??
  (offer.status === "bank_paid" ? offer.statusUpdatedAtSec : null);

/** Seconds from the offer's initiation to the payer's bank payment. */
export const bankPaymentOfferResponseDurationSec = (
  offer: Pick<
    BankPaymentOfferInfo,
    "bankPaidAtSec" | "initiatedAtSec" | "status" | "statusUpdatedAtSec"
  >,
  createdAtSec: number,
): number | null => {
  const initiatedAtSec = offer.initiatedAtSec ?? Math.trunc(createdAtSec);
  const bankPaidAtSec = bankPaymentOfferBankPaidAtSec(offer);
  if (
    !Number.isFinite(initiatedAtSec) ||
    initiatedAtSec <= 0 ||
    bankPaidAtSec === null ||
    bankPaidAtSec < initiatedAtSec
  ) {
    return null;
  }
  return bankPaidAtSec - initiatedAtSec;
};

export const offerUpdatedAtSec = (offer: BankPaymentOffer): number =>
  offer.statusUpdatedAtSec ?? offer.createdAtSec;

export const bankPaymentOffersOf = (
  offers: readonly BankPaymentOffer[],
  offerId: string,
): BankPaymentOffer[] => offers.filter((offer) => offer.offerId === offerId);

export const findBankPaymentOffer = (
  offers: readonly BankPaymentOffer[],
  peer: string,
  offerId: string,
): BankPaymentOffer | null =>
  offers.find((offer) => offer.peer === peer && offer.offerId === offerId) ??
  null;
