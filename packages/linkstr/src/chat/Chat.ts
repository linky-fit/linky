import { Context, Effect, Layer } from "effect";
import type { NoRelayReachable, RecipientNotReached } from "../domain/errors";
import { makeWrapSendContext, sendToPeer } from "../internal/wrapSend";
import type { PeerSendOutcome } from "../internal/wrapSend";
import {
  encodeDeletionRumor,
  encodeEditRumor,
  encodeImageMessageRumor,
  encodeTextMessageRumor,
  encodeTokenMessageRumor,
} from "./codec";
import {
  ChatMessageReceipt,
  MessageDeletionReceipt,
  MessageEditReceipt,
  type DeleteMessageDraft,
  type EditMessageDraft,
  type ImageMessageDraft,
  type TextMessageDraft,
  type TokenMessageDraft,
} from "./domain";

const chatReceipt = (outcome: PeerSendOutcome): ChatMessageReceipt =>
  new ChatMessageReceipt(outcome);

export class Chat extends Context.Service<Chat>()("linkstr/Chat", {
  make: Effect.gen(function* () {
    const context = yield* makeWrapSendContext;

    const sendText = (
      draft: TextMessageDraft,
    ): Effect.Effect<
      ChatMessageReceipt,
      RecipientNotReached | NoRelayReachable
    > =>
      sendToPeer(context, "chat.sendText", draft, {
        encode: encodeTextMessageRumor,
        receipt: chatReceipt,
        pushMarkRecipientCopy: true,
      });

    const sendImage = (
      draft: ImageMessageDraft,
    ): Effect.Effect<
      ChatMessageReceipt,
      RecipientNotReached | NoRelayReachable
    > =>
      sendToPeer(context, "chat.sendImage", draft, {
        encode: encodeImageMessageRumor,
        receipt: chatReceipt,
        pushMarkRecipientCopy: true,
      });

    const sendToken = (
      draft: TokenMessageDraft,
    ): Effect.Effect<
      ChatMessageReceipt,
      RecipientNotReached | NoRelayReachable
    > =>
      sendToPeer(context, "chat.sendToken", draft, {
        encode: encodeTokenMessageRumor,
        receipt: chatReceipt,
        order: "recipientFirst",
      });

    const edit = (
      draft: EditMessageDraft,
    ): Effect.Effect<
      MessageEditReceipt,
      RecipientNotReached | NoRelayReachable
    > =>
      sendToPeer(context, "chat.edit", draft, {
        encode: encodeEditRumor,
        receipt: (outcome) =>
          new MessageEditReceipt({ ...outcome, editOf: draft.editOf }),
      });

    const deleteMessage = (
      draft: DeleteMessageDraft,
    ): Effect.Effect<
      MessageDeletionReceipt,
      RecipientNotReached | NoRelayReachable
    > =>
      sendToPeer(context, "chat.deleteMessage", draft, {
        encode: encodeDeletionRumor,
        receipt: (outcome) =>
          new MessageDeletionReceipt({ ...outcome, deleteOf: draft.deleteOf }),
      });

    return { sendText, sendImage, sendToken, edit, deleteMessage } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
