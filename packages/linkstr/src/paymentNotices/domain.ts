import { Schema } from "effect";
import { WrapDelivery } from "../domain/delivery";
import { ClientId, Pubkey, RumorId, UnixSeconds } from "../domain/primitives";

export const PaymentNoticeContext = Schema.Literal("bank_payment_offer");
export type PaymentNoticeContext = typeof PaymentNoticeContext.Type;

export class PaymentNoticeDraft extends Schema.Class<PaymentNoticeDraft>(
  "PaymentNoticeDraft",
)({
  to: Pubkey,
  context: Schema.optional(PaymentNoticeContext),
  offerId: Schema.optional(Schema.NonEmptyTrimmedString),
  clientId: Schema.optional(ClientId),
}) {}

export class PaymentNoticeReceipt extends Schema.TaggedClass<PaymentNoticeReceipt>()(
  "PaymentNoticeReceipt",
  {
    rumorId: RumorId,
    clientId: ClientId,
    sentAt: UnixSeconds,
    recipientCopy: WrapDelivery,
  },
) {}
