import { Effect } from "effect";
import type { NoRelayReachable, RecipientNotReached } from "../domain/errors";
import { makeWrapSendContext, sendToPeer } from "../internal/wrapSend";
import type { PeerSendOutcome } from "../internal/wrapSend";
import {
  encodeEditRumor,
  encodeImageMessageRumor,
  encodeTextMessageRumor,
  encodeTokenMessageRumor,
} from "./codec";
import {
  ChatMessageReceipt,
  MessageEditReceipt,
  type EditMessageDraft,
  type ImageMessageDraft,
  type TextMessageDraft,
  type TokenMessageDraft,
} from "./domain";

const chatReceipt = (outcome: PeerSendOutcome): ChatMessageReceipt =>
  new ChatMessageReceipt(outcome);

export class Chat extends Effect.Service<Chat>()("linkstr/Chat", {
  effect: Effect.gen(function* () {
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

    return { sendText, sendImage, sendToken, edit } as const;
  }),
}) {}
