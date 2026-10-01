import { Context, Effect, Layer } from "effect";
import type { NoRelayReachable, RecipientNotReached } from "../domain/errors";
import { makeWrapSendContext, sendToPeer } from "../internal/wrapSend";
import { encodeBankOfferRumor } from "./codec";
import {
  BankOfferReceipt,
  shouldPushBankOfferStatus,
  type BankOfferDraft,
} from "./domain";

export class BankOffers extends Context.Service<BankOffers>()(
  "linkstr/BankOffers",
  {
    make: Effect.gen(function* () {
      const context = yield* makeWrapSendContext;

      const send = (
        draft: BankOfferDraft,
      ): Effect.Effect<
        BankOfferReceipt,
        RecipientNotReached | NoRelayReachable
      > =>
        sendToPeer(context, "bankOffers.send", draft, {
          encode: encodeBankOfferRumor,
          pushMarkRecipientCopy:
            draft.pushMark ?? shouldPushBankOfferStatus(draft.status),
          order: "recipientFirst",
          receipt: (outcome, rumor) =>
            new BankOfferReceipt({
              ...outcome,
              offerId: draft.offerId,
              status: draft.status,
              content: rumor.content,
            }),
        });

      return { send } as const;
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make);
}
