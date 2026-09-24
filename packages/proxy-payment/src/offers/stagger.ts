import { BankOfferId, Pubkey } from "@linky/linkstr";
import { Schema } from "effect";
import { NonBlankString, PositiveFiniteNumber } from "../internal/schema";
import { findBankPaymentOffer, type BankPaymentOffer } from "./offer";
import { BANK_PAYMENT_OFFER_PHASE_TTL_SEC } from "./status";

const StaggerRecipient = Schema.Struct({
  dueAtSec: PositiveFiniteNumber,
  peer: Pubkey,
});

/** Recipients of one offer still waiting for their delayed send. */
export const BankPaymentOfferStaggerRecord = Schema.Struct({
  amountSat: Schema.NullOr(PositiveFiniteNumber),
  amountText: NonBlankString,
  createdAtSec: PositiveFiniteNumber,
  expiresAtSec: PositiveFiniteNumber,
  offerId: BankOfferId,
  ownerPubkey: Pubkey,
  pending: Schema.Array(StaggerRecipient),
});
export type BankPaymentOfferStaggerRecord =
  typeof BankPaymentOfferStaggerRecord.Type;

/** Delayed recipients share the first send's expiry, so extending the offer
 * to more people never extends its total lifetime. */
export const bankPaymentOfferStaggerQueue = (args: {
  amountSat: number | null;
  amountText: string;
  delaySec: number;
  firstSentAtSec: number;
  offerId: BankOfferId;
  ownerPubkey: Pubkey;
  peers: readonly Pubkey[];
}): BankPaymentOfferStaggerRecord | null =>
  args.peers.length === 0
    ? null
    : {
        amountSat: args.amountSat,
        amountText: args.amountText,
        createdAtSec: args.firstSentAtSec,
        expiresAtSec: args.firstSentAtSec + BANK_PAYMENT_OFFER_PHASE_TTL_SEC,
        offerId: args.offerId,
        ownerPubkey: args.ownerPubkey,
        pending: args.peers.map((peer, index) => ({
          dueAtSec: args.firstSentAtSec + (index + 1) * args.delaySec,
          peer,
        })),
      };

// A future createdAtSec (backward clock jump) counts as expired so the queue
// never outlives the offered phase.
export const isBankPaymentOfferStaggerRecordExpired = (
  record: BankPaymentOfferStaggerRecord,
  nowSec: number,
): boolean => record.createdAtSec > nowSec || nowSec >= record.expiresAtSec;

/** Only `offered` and `declined` keep the offer open for more recipients;
 * anything else means a winner exists or the whole offer ended. */
export const isBankPaymentOfferStaggerQueueOpen = (
  record: BankPaymentOfferStaggerRecord,
  offers: readonly BankPaymentOffer[],
): boolean =>
  !offers.some(
    (offer) =>
      offer.offerId === record.offerId &&
      offer.status !== "offered" &&
      offer.status !== "declined",
  );

export interface BankPaymentOfferStaggerDue {
  /** Due recipients that already hold a thread (another tab sent it); just dequeue them. */
  alreadyOffered: readonly Pubkey[];
  nextDueAtSec: number | null;
  send: readonly Pubkey[];
}

export const bankPaymentOfferStaggerDue = (
  record: BankPaymentOfferStaggerRecord,
  offers: readonly BankPaymentOffer[],
  nowSec: number,
): BankPaymentOfferStaggerDue => {
  const alreadyOffered: Pubkey[] = [];
  const send: Pubkey[] = [];
  let nextDueAtSec: number | null = null;
  for (const recipient of record.pending) {
    if (recipient.dueAtSec > nowSec) {
      nextDueAtSec =
        nextDueAtSec === null
          ? recipient.dueAtSec
          : Math.min(nextDueAtSec, recipient.dueAtSec);
    } else if (findBankPaymentOffer(offers, recipient.peer, record.offerId)) {
      alreadyOffered.push(recipient.peer);
    } else {
      send.push(recipient.peer);
    }
  }
  return { alreadyOffered, nextDueAtSec, send };
};
