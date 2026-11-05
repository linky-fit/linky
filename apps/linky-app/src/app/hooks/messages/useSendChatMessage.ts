import {
  ClientId,
  ImageMessageDraft,
  MessageText,
  OutboxRef,
  Pubkey,
  RumorId,
  sharedListingMessageText,
  TextMessageDraft,
  type SharedListing,
  UnixSeconds,
} from "@linky-fit/linkstr";
import { useLinkstrCommands } from "@linky-fit/linkstr-react";
import { Cause, Result, Exit, Schema } from "effect";
import React from "react";
import { reportAppLog } from "../../../devtools/inspector/appLog";
import { appendPushDebugLog } from "../../../utils/pushDebugLog";
import { nowSeconds } from "../../../utils/time";
import { makeLocalId } from "../../../utils/validation";
import {
  chatAttachmentErrorKey,
  getChatAttachmentRejection,
  privateImageMessageContent,
  uploadPrivateImage,
} from "../../lib/privateImageMessage";
import type {
  AppendLocalNostrMessage,
  ContactIdentityRowLike,
  UpdateLocalNostrMessage,
} from "../../types/appTypes";
import type { ReplyContext } from "../../state/messages/chat";
import { resolveNostrChatIdentity } from "./contactIdentity";
import type { Translate } from "../../../i18n";

const isPubkey = Schema.is(Pubkey);
const isRumorId = Schema.is(RumorId);
const decodeMessageText = Schema.decodeUnknownResult(MessageText);

export type { ReplyContext };

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
  /** Sent with the draft, under it as the note; never with an image or a given `text`. */
  attachedListing: SharedListing | null;
  chatDraft: string;
  clearAttachedListing: () => void;
  chatSendIsBusy: boolean;
  currentNsec: string | null;
  route: TRoute;
  replyContext: ReplyContext | null;
  /** The reply context as just set, which the rendered one may lag behind. */
  readReplyContext: () => ReplyContext | null;
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
  attachedListing,
  chatDraft,
  chatSendIsBusy,
  clearAttachedListing,
  currentNsec,
  route,
  replyContext,
  readReplyContext,
  selectedContact,
  setReplyContext,
  setChatDraft,
  setChatSendIsBusy,
  setStatus,
  t,
  triggerChatScrollToBottom,
  updateLocalNostrMessage,
}: UseSendChatMessageParams<TRoute, TContact>) => {
  const { enqueueOutbox } = useLinkstrCommands();

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
      const sharedListing =
        imageFile || options?.text !== undefined ? null : attachedListing;
      const note = (options?.text ?? chatDraft).trim();
      const text = sharedListing
        ? sharedListingMessageText(sharedListing, note)
        : note;
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
        const image = imageFile
          ? await uploadPrivateImage(imageFile, { privateKey: privBytes })
          : null;
        const messageContent = image ? privateImageMessageContent(image) : text;
        const activeReplyContext =
          options?.replyContext ?? readReplyContext() ?? replyContext ?? null;
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
        const createdAtSec = UnixSeconds.make(nowSeconds());

        let draft: TextMessageDraft | ImageMessageDraft;
        if (image) {
          draft = new ImageMessageDraft({
            to: contactPubHex,
            image,
            clientId,
            sentAt: createdAtSec,
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
            sentAt: createdAtSec,
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
        if (sharedListing) clearAttachedListing();
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

        updateLocalNostrMessage(pendingId, { rumorId: exit.value.rumorId });
        if (sharedListing) {
          reportAppLog({
            tag: "listings.sharedSent",
            summary: `Shared listing sent: ${sharedListing.listing.side}`,
            links: {
              contact: String(selectedContact.id),
              message: pendingId,
              pubkey: sharedListing.author,
              rumor: exit.value.rumorId,
            },
            payload: {
              hasImage: sharedListing.listing.image !== undefined,
              hasNote: note !== "",
              listingId: sharedListing.listing.id,
            },
          });
        }

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
      attachedListing,
      chatDraft,
      chatSendIsBusy,
      clearAttachedListing,
      currentNsec,
      readReplyContext,
      replyContext,
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
