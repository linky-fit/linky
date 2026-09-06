import {
  ClientId,
  Emoji,
  OutboxRef,
  Pubkey,
  ReactionDraft,
  RetractionDraft,
  RumorId,
  TargetKind,
} from "@linky/linkstr";
import {
  enqueueOutboxAtom,
  retractReactionAtom,
  useAtomSet,
} from "@linky/linkstr-react";
import { Cause, Exit, Schema } from "effect";
import React from "react";
import { makeLocalId } from "../../../utils/validation";
import type {
  ContactIdentityRowLike,
  LocalNostrReaction,
  NewLocalNostrReaction,
  UpdateLocalNostrReaction,
} from "../../types/appTypes";
import { resolveNostrChatIdentity } from "./contactIdentity";
import type { Translate } from "../../../i18n";

const isPubkey = Schema.is(Pubkey);
const isRumorId = Schema.is(RumorId);
const isEmoji = Schema.is(Emoji);

type AppendLocalNostrReaction = (reaction: NewLocalNostrReaction) => string;

interface SendReactionArgs {
  emoji: string;
  messageAuthorPubkey: string;
  messageRumorId: string;
  targetKind: TargetKind;
}

interface UseSendReactionParams<
  TRoute extends { kind: string },
  TContact extends ContactIdentityRowLike,
> {
  appendLocalNostrReaction: AppendLocalNostrReaction;
  currentNsec: string | null;
  reactionsByMessageId: Map<string, LocalNostrReaction[]>;
  route: TRoute;
  selectedContact: TContact | null;
  setStatus: React.Dispatch<React.SetStateAction<string | null>>;
  softDeleteLocalNostrReaction: (id: string) => void;
  t: Translate;
  updateLocalNostrReaction: UpdateLocalNostrReaction;
}

export const useSendReaction = <
  TRoute extends { kind: string },
  TContact extends ContactIdentityRowLike,
>({
  appendLocalNostrReaction,
  currentNsec,
  reactionsByMessageId,
  route,
  selectedContact,
  setStatus,
  softDeleteLocalNostrReaction,
  t,
  updateLocalNostrReaction,
}: UseSendReactionParams<TRoute, TContact>) => {
  const enqueueOutbox = useAtomSet(enqueueOutboxAtom, { mode: "promiseExit" });
  const linkstrRetract = useAtomSet(retractReactionAtom, {
    mode: "promiseExit",
  });

  return React.useCallback(
    async (args: SendReactionArgs) => {
      if (route.kind !== "chat") return;
      if (!selectedContact) return;
      if (!currentNsec) {
        setStatus(t("profileMissingNpub"));
        return;
      }

      const messageRumorId = args.messageRumorId.trim();
      const emoji = args.emoji.trim();
      const messageAuthorPubkey = args.messageAuthorPubkey.trim();
      if (
        !isRumorId(messageRumorId) ||
        !isEmoji(emoji) ||
        !isPubkey(messageAuthorPubkey)
      ) {
        return;
      }

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
        const isOffline =
          typeof navigator !== "undefined" && navigator.onLine === false;

        // One reaction per user per message: replace mine, or toggle off on
        // the same emoji. UX policy lives here, not in linkstr.
        const myReactions = (
          reactionsByMessageId.get(messageRumorId) ?? []
        ).filter((reaction) => reaction.reactorPubkey.trim() === myPubHex);
        const hasSameEmoji = myReactions.some(
          (reaction) => reaction.emoji.trim() === emoji,
        );

        if (myReactions.length > 0) {
          for (const reaction of myReactions) {
            softDeleteLocalNostrReaction(reaction.id);
          }
          const [head, ...tail] = myReactions
            .map((reaction) => reaction.wrapId.trim())
            .filter(isRumorId);
          if (head !== undefined && !isOffline) {
            const exit = await linkstrRetract(
              new RetractionDraft({
                to: contactPubHex,
                reactionIds: [head, ...tail],
              }),
            );
            if (Exit.isFailure(exit)) setStatus(t("chatQueued"));
          }
          if (hasSameEmoji) return;
        }

        const clientId = ClientId.make(makeLocalId());
        const pendingReactionId = appendLocalNostrReaction({
          messageId: messageRumorId,
          reactorPubkey: myPubHex,
          emoji,
          createdAtSec: Math.ceil(Date.now() / 1e3),
          wrapId: `pending:${clientId}`,
          clientId,
          status: "pending",
        });
        if (!pendingReactionId) throw new Error("failed to persist reaction");

        const draft = new ReactionDraft({
          to: contactPubHex,
          target: messageRumorId,
          targetKind: args.targetKind,
          targetAuthor: messageAuthorPubkey,
          emoji,
          clientId,
        });
        const exit = await enqueueOutbox({
          op: { _tag: "reaction", draft },
          ref: OutboxRef.make(`reaction:${pendingReactionId}`),
        });

        if (Exit.isFailure(exit)) {
          setStatus(`${t("errorPrefix")}: ${Cause.pretty(exit.cause)}`);
          return;
        }

        updateLocalNostrReaction(pendingReactionId, {
          wrapId: exit.value.rumorId,
        });

        if (isOffline) {
          setStatus(t("chatQueued"));
        }
      } catch (e) {
        setStatus(`${t("errorPrefix")}: ${String(e ?? "unknown")}`);
      }
    },
    [
      appendLocalNostrReaction,
      currentNsec,
      enqueueOutbox,
      linkstrRetract,
      reactionsByMessageId,
      route.kind,
      selectedContact,
      setStatus,
      softDeleteLocalNostrReaction,
      t,
      updateLocalNostrReaction,
    ],
  );
};
