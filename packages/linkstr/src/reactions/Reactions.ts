import { Context, Effect, Layer } from "effect";
import type { NoRelayReachable, RecipientNotReached } from "../domain/errors";
import { makeWrapSendContext, sendToPeer } from "../internal/wrapSend";
import { encodeReactionRumor, encodeRetractionRumor } from "./codec";
import {
  ReactionReceipt,
  RetractionReceipt,
  type ReactionDraft,
  type RetractionDraft,
} from "./domain";

export class Reactions extends Context.Service<Reactions>()(
  "linkstr/Reactions",
  {
    make: Effect.gen(function* () {
      const context = yield* makeWrapSendContext;

      const react = (
        draft: ReactionDraft,
      ): Effect.Effect<
        ReactionReceipt,
        RecipientNotReached | NoRelayReachable
      > =>
        sendToPeer(context, "reactions.react", draft, {
          encode: encodeReactionRumor,
          receipt: (outcome) => new ReactionReceipt(outcome),
        });

      const retract = (
        draft: RetractionDraft,
      ): Effect.Effect<
        RetractionReceipt,
        RecipientNotReached | NoRelayReachable
      > =>
        sendToPeer(context, "reactions.retract", draft, {
          encode: encodeRetractionRumor,
          receipt: (outcome) => new RetractionReceipt(outcome),
        });

      return { react, retract } as const;
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make);
}
