import { Effect } from "effect";
import type { NoRelayReachable, RecipientNotReached } from "../domain/errors";
import { makeWrapSendContext, sendToPeer } from "../internal/wrapSend";
import { encodeBankOfferRumor } from "./codec";
import {
  BankOfferReceipt,
  shouldPushBankOfferStatus,
  type BankOfferDraft,
} from "./domain";

export class BankOffers extends Effect.Service<BankOffers>()(
  "linkstr/BankOffers",
  {
    effect: Effect.gen(function* () {
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
          // The self copy is the relay's record of who got the bank details.
          order:
            draft.status === "bank_details_sent"
              ? "selfFirst"
              : "recipientFirst",
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
) {}
