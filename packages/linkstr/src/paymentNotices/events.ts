import { Schema } from "effect";
import { Pubkey, RumorId, UnixSeconds } from "../domain/primitives";
import { PaymentNoticeContext } from "./domain";

export class PaymentNoticeReceived extends Schema.TaggedClass<PaymentNoticeReceived>()(
  "PaymentNoticeReceived",
  {
    noticeId: RumorId,
    from: Pubkey,
    context: Schema.NullOr(PaymentNoticeContext),
    offerId: Schema.NullOr(Schema.Trimmed.check(Schema.isNonEmpty())),
    sentAt: UnixSeconds,
  },
) {}

export const PaymentNoticeInboxEvent = Schema.Union([PaymentNoticeReceived]);
export type PaymentNoticeInboxEvent = typeof PaymentNoticeInboxEvent.Type;
