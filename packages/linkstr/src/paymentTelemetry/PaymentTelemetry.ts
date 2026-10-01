import { Context, Effect, Layer } from "effect";
import { generateSecretKey, getPublicKey } from "nostr-tools";
import type { WrapNotDelivered } from "../domain/errors";
import { NostrSecretKey, Pubkey } from "../domain/primitives";
import { nowSeconds } from "../internal/time";
import { makeWrapSendContext, sendToRecipient } from "../internal/wrapSend";
import { encodePaymentTelemetryRumor } from "./codec";
import { PaymentTelemetryReceipt, type PaymentTelemetryDraft } from "./domain";

export class PaymentTelemetry extends Context.Service<PaymentTelemetry>()(
  "linkstr/PaymentTelemetry",
  {
    make: Effect.gen(function* () {
      const context = yield* makeWrapSendContext;

      /** Signed by a fresh ephemeral key per attempt, so nothing links sends. */
      const publishPaymentTelemetry = (
        draft: PaymentTelemetryDraft,
        recipient: Pubkey,
      ): Effect.Effect<PaymentTelemetryReceipt, WrapNotDelivered> =>
        Effect.gen(function* () {
          const senderSecretKey = NostrSecretKey.make(generateSecretKey());
          const author = Pubkey.make(getPublicKey(senderSecretKey));
          const sentAt = yield* nowSeconds;
          return yield* sendToRecipient(
            context,
            "paymentTelemetry.publish",
            { draft, recipient },
            {
              rumor: encodePaymentTelemetryRumor(
                draft,
                author,
                recipient,
                sentAt,
              ),
              recipient,
              clientId: draft.id,
              sentAt,
              senderSecretKey,
              receipt: (outcome) => new PaymentTelemetryReceipt(outcome),
            },
          );
        });

      return { publishPaymentTelemetry } as const;
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make);
}
