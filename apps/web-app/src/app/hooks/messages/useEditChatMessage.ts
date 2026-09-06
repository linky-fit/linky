import {
  ClientId,
  EditMessageDraft,
  MessageText,
  OutboxRef,
  Pubkey,
  RumorId,
} from "@linky/linkstr";
import { enqueueOutboxAtom, useAtomSet } from "@linky/linkstr-react";
import { Cause, Either, Exit, Schema } from "effect";
import React from "react";
import { makeLocalId } from "../../../utils/validation";
import type {
  ContactIdentityRowLike,
  UpdateLocalNostrMessage,
} from "../../types/appTypes";
import { resolveNostrChatIdentity } from "./contactIdentity";
import type { Translate } from "../../../i18n";

const isPubkey = Schema.is(Pubkey);
const isRumorId = Schema.is(RumorId);
const decodeMessageText = Schema.decodeUnknownEither(MessageText);

export interface EditChatContext {
  messageId: string;
  originalContent: string;
  rumorId: string;
}

interface UseEditChatMessageParams<
  TRoute extends { kind: string },
  TContact extends ContactIdentityRowLike,
> {
  chatDraft: string;
  chatSendIsBusy: boolean;
  currentNsec: string | null;
  editContext: EditChatContext | null;
  route: TRoute;
  selectedContact: TContact | null;
  setChatDraft: React.Dispatch<React.SetStateAction<string>>;
  setChatSendIsBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setEditContext: React.Dispatch<React.SetStateAction<EditChatContext | null>>;
  setStatus: React.Dispatch<React.SetStateAction<string | null>>;
  t: Translate;
  updateLocalNostrMessage: UpdateLocalNostrMessage;
}

export const useEditChatMessage = <
  TRoute extends { kind: string },
  TContact extends ContactIdentityRowLike,
>({
  chatDraft,
  chatSendIsBusy,
  currentNsec,
  editContext,
  route,
  selectedContact,
  setChatDraft,
  setChatSendIsBusy,
  setEditContext,
  setStatus,
  t,
  updateLocalNostrMessage,
}: UseEditChatMessageParams<TRoute, TContact>) => {
  const enqueueOutbox = useAtomSet(enqueueOutboxAtom, {
    mode: "promiseExit",
  });

  return React.useCallback(async () => {
    if (route.kind !== "chat") return;
    if (!selectedContact) return;
    if (!editContext) return;

    const editedFromId = editContext.rumorId.trim();
    if (!isRumorId(editedFromId)) return;

    const text = chatDraft.trim();
    if (!text) return;

    if (!currentNsec) {
      setStatus(t("profileMissingNpub"));
      return;
    }

    if (chatSendIsBusy) return;
    setChatSendIsBusy(true);

    try {
      const identity = await resolveNostrChatIdentity(
        currentNsec,
        selectedContact,
      );
      if (!identity || !isPubkey(identity.contactPubHex)) {
        setStatus(t("chatMissingContactNpub"));
        return;
      }
      const { contactPubHex, myPubHex } = identity;
      const content = decodeMessageText(text);
      if (Either.isLeft(content)) {
        throw new Error("invalid message text");
      }

      const clientId = ClientId.make(makeLocalId());
      const editedAtSec = Math.ceil(Date.now() / 1e3);

      updateLocalNostrMessage(editContext.messageId, {
        content: text,
        status: "pending",
        wrapId: `pending:edit:${clientId}`,
        pubkey: myPubHex,
        clientId,
        rumorId: editedFromId,
        isEdited: true,
        editedAtSec,
        editedFromId,
        originalContent: editContext.originalContent.trim()
          ? editContext.originalContent
          : null,
      });
      setChatDraft("");
      setEditContext(null);

      const draft = new EditMessageDraft({
        to: contactPubHex,
        editOf: editedFromId,
        content: content.right,
        clientId,
      });
      const exit = await enqueueOutbox({
        op: { _tag: "chat.edit", draft },
        ref: OutboxRef.make(`message:${editContext.messageId}`),
      });

      if (Exit.isFailure(exit)) {
        setStatus(`${t("errorPrefix")}: ${Cause.pretty(exit.cause)}`);
        return;
      }

      updateLocalNostrMessage(editContext.messageId, {
        createdAtSec: exit.value.sentAt,
        rumorId: editedFromId,
      });

      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        setStatus(t("chatQueued"));
      }
    } catch (e) {
      setStatus(`${t("errorPrefix")}: ${String(e ?? "unknown")}`);
    } finally {
      setChatSendIsBusy(false);
    }
  }, [
    chatDraft,
    chatSendIsBusy,
    currentNsec,
    editContext,
    enqueueOutbox,
    route.kind,
    selectedContact,
    setChatDraft,
    setChatSendIsBusy,
    setEditContext,
    setStatus,
    t,
    updateLocalNostrMessage,
  ]);
};
