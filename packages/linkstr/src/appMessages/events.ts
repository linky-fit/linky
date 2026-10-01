import { Schema } from "effect";
import { ClientId, Pubkey, RumorId, UnixSeconds } from "../domain/primitives";
import { AppNamespace } from "./domain";

/** A peer's app message addressed to you; decode `content` with its channel. */
export class AppMessageReceived extends Schema.TaggedClass<AppMessageReceived>()(
  "AppMessageReceived",
  {
    messageId: RumorId,
    from: Pubkey,
    app: AppNamespace,
    content: Schema.String,
    /** Same value on every retry of one send; null without a valid `client` tag. */
    clientId: Schema.NullOr(ClientId),
    sentAt: UnixSeconds,
  },
) {}

export const AppMessageInboxEvent = Schema.Union([AppMessageReceived]);
export type AppMessageInboxEvent = typeof AppMessageInboxEvent.Type;
