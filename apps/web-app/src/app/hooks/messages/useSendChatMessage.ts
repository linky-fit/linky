import {
  ClientId,
  ImageMessageDraft,
  MessageText,
  OutboxRef,
  PrivateImage,
  Pubkey,
  RumorId,
  TextMessageDraft,
} from "@linky-fit/linkstr";
import { enqueueOutboxAtom, useAtomSet } from "@linky-fit/linkstr-react";
import { Cause, Result, Exit, Schema } from "effect";
import React from "react";
import { appendPushDebugLog } from "../../../utils/pushDebugLog";
import { makeLocalId } from "../../../utils/validation";
import {
  chatAttachmentErrorKey,
  createPrivateImageSendPayload,
  getChatAttachmentRejection,
  parsePrivateImageMessage,
} from "../../lib/privateImageMessage";
import type {
  AppendLocalNostrMessage,
  ContactIdentityRowLike,
  UpdateLocalNostrMessage,
} from "../../types/appTypes";
import { resolveNostrChatIdentity } from "./contactIdentity";
import type { Translate } from "../../../i18n";

const isPubkey = Schema.is(Pubkey);
const isRumorId = Schema.is(RumorId);
const decodeMessageText = Schema.decodeUnknownResult(MessageText);
const decodePrivateImage = Schema.decodeUnknownResult(PrivateImage);

export interface ReplyContext {
  rootMessageId: string | null;
  replyToContent: string | null;
  replyToId: string;
}

interface SendChatMessageOptions {
  clearDraft?: boolean;
  clearReplyContext?: boolean;
  imageFile?: File | null;
  replyContext?: ReplyContext | null;
  text?: string;
}

interface UseSendChatMessageParams<
  TRoute extends { kind: string },
  TContact extends ContactIdentityRowLike,
> {
  appendLocalNostrMessage: AppendLocalNostrMessage;
  chatDraft: string;
  chatSendIsBusy: boolean;
  currentNsec: string | null;
  route: TRoute;
  replyContext: ReplyContext | null;
  replyContextRef: React.MutableRefObject<ReplyContext | null>;
  selectedContact: TContact | null;
  setReplyContext: React.Dispatch<React.SetStateAction<ReplyContext | null>>;
  setChatDraft: React.Dispatch<React.SetStateAction<string>>;
  setChatSendIsBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setStatus: React.Dispatch<React.SetStateAction<string | null>>;
  t: Translate;
  triggerChatScrollToBottom: (messageId?: string) => void;
  updateLocalNostrMessage: UpdateLocalNostrMessage;
}

/** `stored`: the message is in the conversation but the outbox did not take it, so it is not on its way. */
export type ChatSendOutcome = "enqueued" | "failed" | "stored";

export const useSendChatMessage = <
  TRoute extends { kind: string },
  TContact extends ContactIdentityRowLike,
>({
  appendLocalNostrMessage,
  chatDraft,
  chatSendIsBusy,
  currentNsec,
  route,
  replyContext,
  replyContextRef,
  selectedContact,
  setReplyContext,
  setChatDraft,
  setChatSendIsBusy,
  setStatus,
  t,
  triggerChatScrollToBottom,
  updateLocalNostrMessage,
}: UseSendChatMessageParams<TRoute, TContact>) => {
  const enqueueOutbox = useAtomSet(enqueueOutboxAtom, {
    mode: "promiseExit",
  });

  return React.useCallback(
    async (options?: SendChatMessageOptions): Promise<ChatSendOutcome> => {
      if (
        route.kind !== "chat" &&
        route.kind !== "contactPay" &&
        route.kind !== "bankPaymentOffer"
      )
        return "failed";
      if (!selectedContact) return "failed";

      const imageFile = options?.imageFile ?? null;
      const text = (options?.text ?? chatDraft).trim();
      if (!text && !imageFile) return "failed";

      if (!currentNsec) {
        setStatus(t("profileMissingNpub"));
        return "failed";
      }

      if (chatSendIsBusy) return "failed";

      const rejectionKey = imageFile
        ? getChatAttachmentRejection(imageFile)
        : null;
      if (rejectionKey) {
        setStatus(t(rejectionKey));
        return "failed";
      }

      setChatSendIsBusy(true);

      try {
        const identity = await resolveNostrChatIdentity(
          currentNsec,
          selectedContact,
        );
        if (!identity || !isPubkey(identity.contactPubHex)) {
          setStatus(t("chatMissingContactNpub"));
          return "failed";
        }
        const { contactPubHex, myPubHex, privBytes } = identity;

        const clientId = ClientId.make(makeLocalId());
        const imagePayload = imageFile
          ? await createPrivateImageSendPayload(imageFile, {
              privateKey: privBytes,
            })
          : null;
        const messageContent = imagePayload?.content ?? text;
        const mediaInfo = parsePrivateImageMessage(messageContent);
        const activeReplyContext =
          options?.replyContext ??
          replyContextRef.current ??
          replyContext ??
          null;
        const activeReplyToId = (activeReplyContext?.replyToId ?? "").trim();
        const replyTo = isRumorId(activeReplyToId)
          ? activeReplyToId
          : undefined;
        const rootId =
          (activeReplyContext?.rootMessageId ?? "").trim() || replyTo;
        const root =
          replyTo !== undefined && isRumorId(rootId) ? rootId : undefined;
        const clearReplyContextIfCurrent = () => {
          if (!activeReplyToId) return;
          setReplyContext((previous) => {
            const previousReplyToId = (previous?.replyToId ?? "").trim();
            return previousReplyToId === activeReplyToId ? null : previous;
          });
        };
        const createdAtSec = Math.ceil(Date.now() / 1e3);

        let draft: TextMessageDraft | ImageMessageDraft;
        if (imageFile) {
          const image = decodePrivateImage(mediaInfo);
          if (Result.isFailure(image)) {
            throw new Error("invalid private image");
          }
          draft = new ImageMessageDraft({
            to: contactPubHex,
            image: image.success,
            clientId,
            ...(replyTo === undefined ? {} : { replyTo }),
            ...(root === undefined ? {} : { root }),
          });
        } else {
          const content = decodeMessageText(text);
          if (Result.isFailure(content)) {
            throw new Error("invalid message text");
          }
          draft = new TextMessageDraft({
            to: contactPubHex,
            content: content.success,
            clientId,
            ...(replyTo === undefined ? {} : { replyTo }),
            ...(root === undefined ? {} : { root }),
          });
        }

        const appended = appendLocalNostrMessage({
          contactId: String(selectedContact.id),
          direction: "out",
          content: messageContent,
          wrapId: `pending:${clientId}`,
          rumorId: null,
          pubkey: myPubHex,
          createdAtSec,
          status: "pending",
          clientId,
          ...(activeReplyContext?.replyToId
            ? {
                replyToId: activeReplyContext.replyToId,
                replyToContent: activeReplyContext.replyToContent,
                rootMessageId:
                  (activeReplyContext.rootMessageId ?? "").trim() ||
                  activeReplyContext.replyToId,
              }
            : {}),
        });
        const pendingId = appended.id;
        if (!pendingId) throw new Error("failed to persist message");
        const written = await appended.written;
        if (!written.ok) throw new Error(written.error);
        triggerChatScrollToBottom(pendingId);
        const clearDraft = options?.clearDraft !== false;
        if (clearDraft) setChatDraft("");
        if (options?.clearReplyContext ?? clearDraft) {
          clearReplyContextIfCurrent();
        }

        const exit = await enqueueOutbox({
          op:
            draft instanceof ImageMessageDraft
              ? { _tag: "chat.image", draft }
              : { _tag: "chat.text", draft },
          ref: OutboxRef.make(`message:${pendingId}`),
        });
        if (Exit.isFailure(exit)) {
          setStatus(`${t("errorPrefix")}: ${Cause.pretty(exit.cause)}`);
          return "stored";
        }

        updateLocalNostrMessage(pendingId, {
          createdAtSec: exit.value.sentAt,
          rumorId: exit.value.rumorId,
        });

        appendPushDebugLog("client", "chat send enqueued", {
          clientId,
          rumorId: exit.value.rumorId,
        });

        if (typeof navigator !== "undefined" && navigator.onLine === false) {
          setStatus(t("chatQueued"));
        }
        return "enqueued";
      } catch (e) {
        const attachmentErrorKey = chatAttachmentErrorKey(e);
        setStatus(
          attachmentErrorKey
            ? t(attachmentErrorKey)
            : `${t("errorPrefix")}: ${String(e ?? "unknown")}`,
        );
        return "failed";
      } finally {
        setChatSendIsBusy(false);
      }
    },
    [
      appendLocalNostrMessage,
      chatDraft,
      chatSendIsBusy,
      currentNsec,
      replyContext,
      replyContextRef,
      route.kind,
      selectedContact,
      enqueueOutbox,
      setReplyContext,
      setChatDraft,
      setChatSendIsBusy,
      setStatus,
      t,
      triggerChatScrollToBottom,
      updateLocalNostrMessage,
    ],
  );
};
