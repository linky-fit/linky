import {
  ClientId,
  DeleteMessageDraft,
  OutboxRef,
  Pubkey,
  RumorId,
} from "@linky-fit/linkstr";
import { useLinkstrCommands } from "@linky-fit/linkstr-react";
import { Cause, Exit, Schema } from "effect";
import React from "react";
import { reportAppLog } from "../../../devtools/inspector/appLog";
import type { Translate } from "../../../i18n";
import { makeLocalId } from "../../../utils/validation";
import { parsePrivateImageMessage } from "../../lib/privateImageMessage";
import type { WriteOutcome } from "../../lib/storeWrite";
import type {
  ContactIdentityRowLike,
  LocalNostrMessage,
} from "../../types/appTypes";
import { resolveNostrChatIdentity } from "./contactIdentity";

const isPubkey = Schema.is(Pubkey);
const isRumorId = Schema.is(RumorId);

interface UseDeleteChatMessageParams<TContact extends ContactIdentityRowLike> {
  currentNsec: string | null;
  markLocalNostrMessageDeleted: (
    message: LocalNostrMessage,
  ) => Promise<WriteOutcome>;
  selectedContact: TContact | null;
  setStatus: (status: string) => void;
  t: Translate;
}

/**
 * Deletes a message for both sides: the local row turns into a placeholder at
 * once, and a NIP-09 deletion request is queued for the peer. A message that
 * never got a rumor id (nothing was enqueued for it) is only marked locally.
 */
export const useDeleteChatMessage = <TContact extends ContactIdentityRowLike>({
  currentNsec,
  markLocalNostrMessageDeleted,
  selectedContact,
  setStatus,
  t,
}: UseDeleteChatMessageParams<TContact>) => {
  const { enqueueOutbox } = useLinkstrCommands();

  return React.useCallback(
    async (message: LocalNostrMessage) => {
      const messageId = message.id.trim();
      if (!messageId) return;
      const rumorId = (message.rumorId ?? "").trim();
      void markLocalNostrMessageDeleted(message);
      if (!isRumorId(rumorId)) return;

      if (!currentNsec) {
        setStatus(t("profileMissingNpub"));
        return;
      }
      try {
        const identity = selectedContact
          ? await resolveNostrChatIdentity(currentNsec, selectedContact)
          : null;
        if (!identity || !isPubkey(identity.contactPubHex)) {
          setStatus(t("chatMissingContactNpub"));
          return;
        }
        const clientId = ClientId.make(makeLocalId());
        const draft = new DeleteMessageDraft({
          to: identity.contactPubHex,
          deleteOf: rumorId,
          deleteOfKind: parsePrivateImageMessage(message.content)
            ? "image"
            : "text",
          clientId,
        });
        const exit = await enqueueOutbox({
          op: { _tag: "chat.delete", draft },
          ref: OutboxRef.make(`deletion:${messageId}`),
        });
        if (Exit.isFailure(exit)) {
          setStatus(`${t("errorPrefix")}: ${Cause.pretty(exit.cause)}`);
          return;
        }
        reportAppLog({
          tag: "messages.deleted",
          summary: "Deleted a message for both sides",
          links: {
            rumor: exit.value.rumorId,
            message: rumorId,
            contact: message.contactId,
          },
          payload: { direction: message.direction },
        });
      } catch (e) {
        setStatus(`${t("errorPrefix")}: ${String(e ?? "unknown")}`);
      }
    },
    [
      currentNsec,
      enqueueOutbox,
      markLocalNostrMessageDeleted,
      selectedContact,
      setStatus,
      t,
    ],
  );
};
