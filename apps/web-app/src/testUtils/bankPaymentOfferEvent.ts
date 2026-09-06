import {
  BANK_OFFER_KIND,
  BANK_OFFER_VALUE,
  BankOfferId,
  encodeBankOfferContent,
  Pubkey,
  UnixSeconds,
} from "@linky/linkstr";
import type { UnsignedEvent } from "nostr-tools";
import {
  getLinkyBankPaymentOfferMessageText,
  type LinkyBankPaymentOfferStatus,
} from "../app/lib/bankPaymentOffer";

const unixSeconds = (value: number | null | undefined): UnixSeconds | null =>
  value === null || value === undefined ? null : UnixSeconds.make(value);

/** Offer event with the production wire encoding; pubkeys must be real hex keys. */
export const createLinkyBankPaymentOfferEvent = (args: {
  amountText: string;
  amountSat?: number | null;
  bankPaidAtSec?: number | null;
  clientId: string;
  createdAt: number;
  expiresAtSec?: number | null;
  extensionSec?: number | null;
  initiatedAtSec?: number | null;
  offererPublicKey?: string;
  offerId?: string;
  recipientPublicKey: string;
  senderPublicKey: string;
  spdPayload?: string | null;
  status?: LinkyBankPaymentOfferStatus;
}): UnsignedEvent => {
  const status = args.status ?? "offered";
  const offerId = BankOfferId.make(args.offerId ?? args.clientId);
  const offerer = Pubkey.make(args.offererPublicKey ?? args.senderPublicKey);
  const sentAt = UnixSeconds.make(args.createdAt);
  const content = encodeBankOfferContent({
    amountSat: args.amountSat ?? null,
    amountText: args.amountText,
    bankPaidAtSec:
      unixSeconds(args.bankPaidAtSec) ??
      (status === "bank_paid" ? sentAt : null),
    expiresAtSec: unixSeconds(args.expiresAtSec),
    extensionSec: args.extensionSec ?? null,
    initiatedAtSec:
      unixSeconds(args.initiatedAtSec) ??
      (status === "offered" ? sentAt : null),
    offerId,
    offerer,
    spdPayload: args.spdPayload ?? null,
    status,
    statusUpdatedAtSec: sentAt,
    text: getLinkyBankPaymentOfferMessageText(
      args.amountText,
      status,
      args.extensionSec,
    ),
  });

  return {
    content,
    created_at: args.createdAt,
    kind: BANK_OFFER_KIND,
    pubkey: args.senderPublicKey,
    tags: [
      ["p", args.recipientPublicKey],
      ["p", args.senderPublicKey],
      ["client", args.clientId],
      ["offer", offerId],
      ["offerer", offerer],
      ["linky", BANK_OFFER_VALUE],
      ["status", status],
    ],
  };
};
