import type { BankOfferStatus } from "@linky/linkstr";

export const BANK_PAYMENT_OFFER_PHASE_TTL_SEC = 5 * 60;
export const BANK_PAYMENT_OFFER_EXTENSION_SEC = 60;
export const BANK_PAYMENT_OFFER_DEFAULT_RECIPIENT_COUNT = 2;
export const BANK_PAYMENT_OFFER_MIN_RECIPIENT_COUNT = 1;
export const BANK_PAYMENT_OFFER_MAX_RECIPIENT_COUNT = 10;
export const BANK_PAYMENT_OFFER_DEFAULT_STAGGER_DELAY_SEC = 0;
export const BANK_PAYMENT_OFFER_MIN_STAGGER_DELAY_SEC = 0;
export const BANK_PAYMENT_OFFER_MAX_STAGGER_DELAY_SEC = 30;
export const BANK_PAYMENT_OFFER_STAGGER_DELAY_STEP_SEC = 5;

/** Statuses only the offerer sends; every other status comes from a payer. */
export const isOffererBankPaymentOfferStatus = (
  status: BankOfferStatus,
): boolean =>
  status === "offered" ||
  status === "bank_details_sent" ||
  status === "accepted_by_other" ||
  status === "canceled" ||
  status === "settled";

/** Ends one recipient's thread of the offer. */
export const isTerminalBankPaymentOfferStatus = (
  status: BankOfferStatus,
): boolean =>
  status === "accepted_by_other" ||
  status === "canceled" ||
  status === "declined" ||
  status === "settled";

/** Ends the offer for every recipient, unlike `declined`. */
export const isWholeOfferTerminalStatus = (status: BankOfferStatus): boolean =>
  status === "canceled" || status === "settled";

/** Merge precedence between snapshots with the same timestamp, not the
 * lifecycle order: a decline outranks the phases it can interrupt. */
export const bankPaymentOfferStatusRank = (status: BankOfferStatus): number => {
  switch (status) {
    case "offered":
      return 0;
    case "accepted":
      return 1;
    case "bank_details_sent":
      return 2;
    case "bank_paid":
      return 3;
    case "declined":
      return 4;
    case "accepted_by_other":
      return 5;
    case "canceled":
      return 6;
    case "settled":
      return 7;
  }
};

export const hasBankPaymentOfferTimedPhase = (
  status: BankOfferStatus,
): boolean =>
  status === "accepted" ||
  status === "bank_details_sent" ||
  status === "bank_paid" ||
  status === "offered";

const clamp = (value: number, min: number, max: number, fallback: number) =>
  Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;

export const clampBankPaymentOfferRecipientCount = (value: number): number =>
  clamp(
    value,
    BANK_PAYMENT_OFFER_MIN_RECIPIENT_COUNT,
    BANK_PAYMENT_OFFER_MAX_RECIPIENT_COUNT,
    BANK_PAYMENT_OFFER_DEFAULT_RECIPIENT_COUNT,
  );

export const clampBankPaymentOfferStaggerDelaySec = (value: number): number =>
  clamp(
    value,
    BANK_PAYMENT_OFFER_MIN_STAGGER_DELAY_SEC,
    BANK_PAYMENT_OFFER_MAX_STAGGER_DELAY_SEC,
    BANK_PAYMENT_OFFER_DEFAULT_STAGGER_DELAY_SEC,
  );
