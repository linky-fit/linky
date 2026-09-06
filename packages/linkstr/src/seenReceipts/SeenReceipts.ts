import { Effect } from "effect";
import type { NoRelayReachable, RecipientNotReached } from "../domain/errors";
import { makeWrapSendContext, sendToPeer } from "../internal/wrapSend";
import { encodeSeenReceiptRumor } from "./codec";
import { SeenReceiptSendReceipt, type SeenReceiptDraft } from "./domain";

export class SeenReceipts extends Effect.Service<SeenReceipts>()(
  "linkstr/SeenReceipts",
  {
    effect: Effect.gen(function* () {
      const context = yield* makeWrapSendContext;

      const send = (
        draft: SeenReceiptDraft,
      ): Effect.Effect<
        SeenReceiptSendReceipt,
        RecipientNotReached | NoRelayReachable
      > =>
        sendToPeer(context, "seenReceipts.send", draft, {
          encode: encodeSeenReceiptRumor,
          receipt: (outcome) => new SeenReceiptSendReceipt(outcome),
        });

      return { send } as const;
    }),
  },
) {}
