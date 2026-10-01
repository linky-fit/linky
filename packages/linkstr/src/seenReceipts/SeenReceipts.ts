import { Context, Effect, Layer } from "effect";
import type { NoRelayReachable, RecipientNotReached } from "../domain/errors";
import { makeWrapSendContext, sendToPeer } from "../internal/wrapSend";
import { encodeSeenReceiptRumor } from "./codec";
import { SeenReceiptSendReceipt, type SeenReceiptDraft } from "./domain";

export class SeenReceipts extends Context.Service<SeenReceipts>()(
  "linkstr/SeenReceipts",
  {
    make: Effect.gen(function* () {
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
) {
  static readonly layer = Layer.effect(this, this.make);
}
