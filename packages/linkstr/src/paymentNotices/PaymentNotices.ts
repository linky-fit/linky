import { Effect } from "effect";
import type { WrapNotDelivered } from "../domain/errors";
import { freshClientId } from "../internal/operations";
import { nowSeconds } from "../internal/time";
import { makeWrapSendContext, sendToRecipient } from "../internal/wrapSend";
import { encodePaymentNoticeRumor } from "./codec";
import { PaymentNoticeReceipt, type PaymentNoticeDraft } from "./domain";

export class PaymentNotices extends Effect.Service<PaymentNotices>()(
  "linkstr/PaymentNotices",
  {
    effect: Effect.gen(function* () {
      const context = yield* makeWrapSendContext;

      const send = (
        draft: PaymentNoticeDraft,
      ): Effect.Effect<PaymentNoticeReceipt, WrapNotDelivered> =>
        Effect.gen(function* () {
          const clientId = draft.clientId ?? (yield* freshClientId);
          const sentAt = yield* nowSeconds;
          return yield* sendToRecipient(context, "paymentNotices.send", draft, {
            rumor: encodePaymentNoticeRumor(
              draft,
              context.identity.pubkey,
              sentAt,
              clientId,
            ),
            recipient: draft.to,
            clientId,
            sentAt,
            pushMark: true,
            receipt: (outcome) => new PaymentNoticeReceipt(outcome),
          });
        });

      return { send } as const;
    }),
  },
) {}
