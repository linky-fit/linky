import { Context, Effect, Layer, Option, Schema } from "effect";
import type { WrapNotDelivered } from "../domain/errors";
import type { ClientId, Pubkey } from "../domain/primitives";
import { freshClientId } from "../internal/operations";
import { nowSeconds } from "../internal/time";
import { makeWrapSendContext, sendToRecipient } from "../internal/wrapSend";
import { encodeAppMessageRumor } from "./codec";
import { AppMessageDraft, AppMessageReceipt } from "./domain";
import type { AppNamespace } from "./domain";
import type { AppMessageReceived } from "./events";

/**
 * Private messages an app defines itself: one gift-wrapped kind 24137 rumor
 * to the recipient only (no self copy), tagged with the app's namespace.
 * Received through `WrapInbox` as `AppMessageReceived`.
 */
export class AppMessages extends Context.Service<AppMessages>()(
  "linkstr/AppMessages",
  {
    make: Effect.gen(function* () {
      const context = yield* makeWrapSendContext;

      const send = (
        draft: AppMessageDraft,
      ): Effect.Effect<AppMessageReceipt, WrapNotDelivered> =>
        Effect.gen(function* () {
          const clientId = draft.clientId ?? (yield* freshClientId);
          const sentAt = draft.sentAt ?? (yield* nowSeconds);
          return yield* sendToRecipient(
            context,
            "appMessages.send",
            // The content is the app's own and may carry secrets.
            { to: draft.to, app: draft.app, clientId },
            {
              rumor: encodeAppMessageRumor(
                draft,
                context.identity.pubkey,
                sentAt,
                clientId,
              ),
              recipient: draft.to,
              clientId,
              sentAt,
              receipt: (outcome) => new AppMessageReceipt(outcome),
            },
          );
        });

      return { send } as const;
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make);
}

/** One app's typed message codec over `AppMessages` and `WrapInbox`. */
export interface AppMessageChannel<A> {
  readonly app: AppNamespace;
  /** A draft carrying `message` as JSON; send it or enqueue it as `appMessage`. */
  readonly draft: (
    to: Pubkey,
    message: A,
    options?: { readonly clientId?: ClientId },
  ) => AppMessageDraft;
  /** `message` when the event is this app's and its JSON matches the schema. */
  readonly decode: (event: AppMessageReceived) => Option.Option<A>;
}

export const appMessageChannel = <A, I>(
  app: AppNamespace,
  schema: Schema.Codec<A, I>,
): AppMessageChannel<A> => {
  const json = Schema.fromJsonString(schema);
  const encode = Schema.encodeSync(json);
  const decode = Schema.decodeUnknownOption(json);
  return {
    app,
    draft: (to, message, options) =>
      new AppMessageDraft({
        to,
        app,
        content: encode(message),
        ...(options?.clientId === undefined
          ? {}
          : { clientId: options.clientId }),
      }),
    decode: (event) =>
      event.app === app ? decode(event.content) : Option.none(),
  };
};
