import { Schema } from "effect";
import { WrapDelivery } from "../domain/delivery";
import { ClientId, Pubkey, RumorId, UnixSeconds } from "../domain/primitives";

/**
 * Names the app a message belongs to (`["app", <namespace>]`), so apps
 * sharing an identity and relays ignore each other's messages.
 */
export const AppNamespace = Schema.NonEmptyTrimmedString.pipe(
  Schema.maxLength(64),
  Schema.brand("AppNamespace"),
);
export type AppNamespace = typeof AppNamespace.Type;

export class AppMessageDraft extends Schema.Class<AppMessageDraft>(
  "AppMessageDraft",
)({
  to: Pubkey,
  app: AppNamespace,
  /** Opaque to linkstr; `appMessageChannel` fills it with schema-encoded JSON. */
  content: Schema.String,
  clientId: Schema.optional(ClientId),
  sentAt: Schema.optional(UnixSeconds),
}) {}

export class AppMessageReceipt extends Schema.TaggedClass<AppMessageReceipt>()(
  "AppMessageReceipt",
  {
    rumorId: RumorId,
    clientId: ClientId,
    sentAt: UnixSeconds,
    recipientCopy: WrapDelivery,
  },
) {}
