import {
  ClientId,
  ImageMessageDraft,
  MessageText,
  OutboxRef,
  PrivateImage,
  Pubkey,
  RumorId,
  TextMessageDraft,
} from "@linky/linkstr";
import { enqueueOutboxAtom, useAtomSet } from "@linky/linkstr-react";
import { Cause, Either, Exit, Schema } from "effect";
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
  ContactIdentityRowLike,
  NewLocalNostrMessage,
  UpdateLocalNostrMessage,
} from "../../types/appTypes";
import { resolveNostrChatIdentity } from "./contactIdentity";
import type { Translate } from "../../../i18n";

type AppendLocalNostrMessage = (message: NewLocalNostrMessage) => string;

const isPubkey = Schema.is(Pubkey);
const isRumorId = Schema.is(RumorId);
const decodeMessageText = Schema.decodeUnknownEither(MessageText);
const decodePrivateImage = Schema.decodeUnknownEither(PrivateImage);

export interface ReplyContext {
  rootMessageId: string | null;
  replyToContent: string | null;
  replyToId: string;
}

interface SendChatMessageOptions {
  clearDraft?: boolean;
  imageFile?: File | null;
  replyContext?: ReplyContext | null;
  text?: string;
}

interface SendChatMessageToArgs {
  contact: ContactIdentityRowLike;
  imageFile?: File | null;
  /** Runs once the outgoing row is persisted locally, before publishing. */
  onPersisted?: () => void;
  replyContext?: ReplyContext | null;
  text: string;
}

interface UseSendChatMessageToParams {
  appendLocalNostrMessage: AppendLocalNostrMessage;
  chatSendIsBusy: boolean;
  currentNsec: string | null;
  setChatSendIsBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setStatus: React.Dispatch<React.SetStateAction<string | null>>;
  t: Translate;
  triggerChatScrollToBottom: (messageId?: string) => void;
  updateLocalNostrMessage: UpdateLocalNostrMessage;
}

interface UseSendChatMessageParams<
  TRoute extends { kind: string },
  TContact extends ContactIdentityRowLike,
> extends UseSendChatMessageToParams {
  chatDraft: string;
  route: TRoute;
  replyContext: ReplyContext | null;
  replyContextRef: React.MutableRefObject<ReplyContext | null>;
  selectedContact: TContact | null;
  setReplyContext: React.Dispatch<React.SetStateAction<ReplyContext | null>>;
  setChatDraft: React.Dispatch<React.SetStateAction<string>>;
}

/** Sends a text or image message to an explicit contact, independent of the route. */
export const useSendChatMessageTo = ({
  appendLocalNostrMessage,
  chatSendIsBusy,
  currentNsec,
  setChatSendIsBusy,
  setStatus,
  t,
  triggerChatScrollToBottom,
  updateLocalNostrMessage,
}: UseSendChatMessageToParams) => {
  const enqueueOutbox = useAtomSet(enqueueOutboxAtom, {
    mode: "promiseExit",
  });

  return React.useCallback(
    async ({
      contact,
      imageFile = null,
      onPersisted,
      replyContext = null,
      text,
    }: SendChatMessageToArgs) => {
      if (!text && !imageFile) return;

      if (!currentNsec) {
        setStatus(t("profileMissingNpub"));
        return;
      }

      if (chatSendIsBusy) return;

      const rejectionKey = imageFile
        ? getChatAttachmentRejection(imageFile)
        : null;
      if (rejectionKey) {
        setStatus(t(rejectionKey));
        return;
      }

      setChatSendIsBusy(true);

      try {
        const identity = await resolveNostrChatIdentity(currentNsec, contact);
        if (!identity || !isPubkey(identity.contactPubHex)) {
          setStatus(t("chatMissingContactNpub"));
          return;
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
        const replyToId = (replyContext?.replyToId ?? "").trim();
        const replyTo = isRumorId(replyToId) ? replyToId : undefined;
        const rootId = (replyContext?.rootMessageId ?? "").trim() || replyTo;
        const root =
          replyTo !== undefined && isRumorId(rootId) ? rootId : undefined;
        const createdAtSec = Math.ceil(Date.now() / 1e3);

        let draft: TextMessageDraft | ImageMessageDraft;
        if (imageFile) {
          const image = decodePrivateImage(mediaInfo);
          if (Either.isLeft(image)) {
            throw new Error("invalid private image");
          }
          draft = new ImageMessageDraft({
            to: contactPubHex,
            image: image.right,
            clientId,
            ...(replyTo === undefined ? {} : { replyTo }),
            ...(root === undefined ? {} : { root }),
          });
        } else {
          const content = decodeMessageText(text);
          if (Either.isLeft(content)) {
            throw new Error("invalid message text");
          }
          draft = new TextMessageDraft({
            to: contactPubHex,
            content: content.right,
            clientId,
            ...(replyTo === undefined ? {} : { replyTo }),
            ...(root === undefined ? {} : { root }),
          });
        }

        const pendingId = appendLocalNostrMessage({
          contactId: String(contact.id),
          direction: "out",
          content: messageContent,
          wrapId: `pending:${clientId}`,
          rumorId: null,
          pubkey: myPubHex,
          createdAtSec,
          status: "pending",
          clientId,
          ...(replyContext?.replyToId
            ? {
                replyToId: replyContext.replyToId,
                replyToContent: replyContext.replyToContent,
                rootMessageId:
                  (replyContext.rootMessageId ?? "").trim() ||
                  replyContext.replyToId,
              }
            : {}),
        });
        if (!pendingId) throw new Error("failed to persist message");
        triggerChatScrollToBottom(pendingId);
        onPersisted?.();

        const exit = await enqueueOutbox({
          op:
            draft instanceof ImageMessageDraft
              ? { _tag: "chat.image", draft }
              : { _tag: "chat.text", draft },
          ref: OutboxRef.make(`message:${pendingId}`),
        });
        if (Exit.isFailure(exit)) {
          setStatus(`${t("errorPrefix")}: ${Cause.pretty(exit.cause)}`);
          return;
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
      } catch (e) {
        const attachmentErrorKey = chatAttachmentErrorKey(e);
        setStatus(
          attachmentErrorKey
            ? t(attachmentErrorKey)
            : `${t("errorPrefix")}: ${String(e ?? "unknown")}`,
        );
      } finally {
        setChatSendIsBusy(false);
      }
    },
    [
      appendLocalNostrMessage,
      chatSendIsBusy,
      currentNsec,
      enqueueOutbox,
      setChatSendIsBusy,
      setStatus,
      t,
      triggerChatScrollToBottom,
      updateLocalNostrMessage,
    ],
  );
};

/** The chat composer's send: targets the selected contact and clears the draft. */
export const useSendChatMessage = <
  TRoute extends { kind: string },
  TContact extends ContactIdentityRowLike,
>({
  chatDraft,
  route,
  replyContext,
  replyContextRef,
  selectedContact,
  setReplyContext,
  setChatDraft,
  ...sendParams
}: UseSendChatMessageParams<TRoute, TContact>) => {
  const sendChatMessageTo = useSendChatMessageTo(sendParams);

  return React.useCallback(
    async (options?: SendChatMessageOptions) => {
      if (
        route.kind !== "chat" &&
        route.kind !== "contactPay" &&
        route.kind !== "bankPaymentOffer"
      )
        return;
      if (!selectedContact) return;

      const imageFile = options?.imageFile ?? null;
      const text = (options?.text ?? chatDraft).trim();
      if (!text && !imageFile) return;

      const activeReplyContext =
        options?.replyContext ??
        replyContextRef.current ??
        replyContext ??
        null;
      const activeReplyToId = (activeReplyContext?.replyToId ?? "").trim();

      await sendChatMessageTo({
        contact: selectedContact,
        imageFile,
        replyContext: activeReplyContext,
        text,
        onPersisted: () => {
          if (options?.clearDraft === false) return;
          setChatDraft("");
          if (!activeReplyToId) return;
          setReplyContext((previous) => {
            const previousReplyToId = (previous?.replyToId ?? "").trim();
            return previousReplyToId === activeReplyToId ? null : previous;
          });
        },
      });
    },
    [
      chatDraft,
      replyContext,
      replyContextRef,
      route.kind,
      selectedContact,
      sendChatMessageTo,
      setChatDraft,
      setReplyContext,
    ],
  );
};
