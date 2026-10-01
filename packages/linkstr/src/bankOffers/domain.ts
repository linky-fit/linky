import { Schema } from "effect";
import { WrapDelivery } from "../domain/delivery";
import { ClientId, Pubkey, RumorId, UnixSeconds } from "../domain/primitives";

export const BankOfferId = Schema.Trimmed.check(Schema.isNonEmpty()).pipe(
  Schema.brand("BankOfferId"),
);
export type BankOfferId = typeof BankOfferId.Type;

export const BankOfferStatus = Schema.Literals([
  "offered",
  "accepted",
  "accepted_by_other",
  "bank_details_sent",
  "bank_paid",
  "canceled",
  "declined",
  "settled",
]);
export type BankOfferStatus = typeof BankOfferStatus.Type;

const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0));

export class BankOfferDraft extends Schema.Class<BankOfferDraft>(
  "BankOfferDraft",
)({
  to: Pubkey,
  offerId: BankOfferId,
  offerer: Pubkey,
  status: BankOfferStatus,
  amountText: Schema.Trimmed.check(Schema.isNonEmpty()),
  text: Schema.Trimmed.check(Schema.isNonEmpty()),
  amountSat: Schema.optional(PositiveInt),
  initiatedAtSec: Schema.optional(UnixSeconds),
  bankPaidAtSec: Schema.optional(UnixSeconds),
  expiresAtSec: Schema.optional(UnixSeconds),
  extensionSec: Schema.optional(PositiveInt),
  spdPayload: Schema.optional(Schema.Trimmed.check(Schema.isNonEmpty())),
  pushMark: Schema.optional(Schema.Boolean),
  clientId: Schema.optional(ClientId),
}) {}

export class BankOfferReceipt extends Schema.TaggedClass<BankOfferReceipt>()(
  "BankOfferReceipt",
  {
    rumorId: RumorId,
    offerId: BankOfferId,
    status: BankOfferStatus,
    /** The encoded snapshot JSON; the app persists it as the offer's local state. */
    content: Schema.String,
    clientId: ClientId,
    sentAt: UnixSeconds,
    selfCopy: WrapDelivery,
    recipientCopy: WrapDelivery,
  },
) {}

export const shouldPushBankOfferStatus = (status: BankOfferStatus): boolean =>
  status === "offered" ||
  status === "accepted" ||
  status === "accepted_by_other" ||
  status === "bank_details_sent" ||
  status === "bank_paid" ||
  status === "declined";
