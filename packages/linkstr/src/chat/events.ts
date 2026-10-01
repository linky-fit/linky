import { Schema } from "effect";
import { ClientId, Pubkey, RumorId, UnixSeconds } from "../domain/primitives";
import { CashuTokenText, PrivateImage } from "./domain";

export class TextBody extends Schema.TaggedClass<TextBody>()("TextBody", {
  text: Schema.String,
}) {}

export class ImageBody extends Schema.TaggedClass<ImageBody>()("ImageBody", {
  image: PrivateImage,
}) {}

export class TokenBody extends Schema.TaggedClass<TokenBody>()("TokenBody", {
  token: CashuTokenText,
}) {}

export const MessageBody = Schema.Union([TextBody, ImageBody, TokenBody]);
export type MessageBody = typeof MessageBody.Type;

export class ChatMessageReceived extends Schema.TaggedClass<ChatMessageReceived>()(
  "ChatMessageReceived",
  {
    messageId: RumorId,
    from: Pubkey,
    body: MessageBody,
    replyTo: Schema.NullOr(RumorId),
    root: Schema.NullOr(RumorId),
    editOf: Schema.NullOr(RumorId),
    sentAt: UnixSeconds,
  },
) {}

/**
 * Our own message observed on a relay — the echo of the self copy, or a send
 * from another device. The reconciliation signal, distinct by construction
 * from an incoming message.
 */
export class OwnChatMessageConfirmed extends Schema.TaggedClass<OwnChatMessageConfirmed>()(
  "OwnChatMessageConfirmed",
  {
    messageId: RumorId,
    to: Pubkey,
    body: MessageBody,
    replyTo: Schema.NullOr(RumorId),
    root: Schema.NullOr(RumorId),
    editOf: Schema.NullOr(RumorId),
    clientId: Schema.NullOr(ClientId),
    sentAt: UnixSeconds,
  },
) {}

export const ChatInboxEvent = Schema.Union([
  ChatMessageReceived,
  OwnChatMessageConfirmed,
]);
export type ChatInboxEvent = typeof ChatInboxEvent.Type;
