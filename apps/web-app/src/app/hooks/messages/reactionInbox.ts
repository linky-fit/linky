import type {
  OwnReactionConfirmed,
  OwnRetractionConfirmed,
  ReactionAdded,
  ReactionRetracted,
} from "@linky/linkstr";
import type {
  LocalNostrMessage,
  LocalNostrReaction,
  NewLocalNostrReaction,
  UpdateLocalNostrReaction,
} from "../../types/appTypes";
import { trimString } from "../../../utils/validation";

const MAX_DEFERRED_REACTIONS = 100;

export type ReactionInboxEvent =
  | ReactionAdded
  | OwnReactionConfirmed
  | ReactionRetracted
  | OwnRetractionConfirmed;

type DeferrableReactionEvent = ReactionAdded | OwnReactionConfirmed;

interface ReactionInboxSessionState {
  deferredReactions: Map<string, DeferrableReactionEvent>;
  /** reactionId → retractor. Suppression is authorship-scoped: a peer's
   * retraction must not block reactions they did not author. */
  retractedReactions: Map<string, string>;
}

export const createReactionInboxSessionState =
  (): ReactionInboxSessionState => ({
    deferredReactions: new Map(),
    retractedReactions: new Map(),
  });

export interface ReactionInboxContext {
  appendLocalNostrReaction: (reaction: NewLocalNostrReaction) => string;
  identitySinceSec: number | null;
  isBlockedPubkey: (pubkey: string) => boolean;
  /** Every stored reaction wrapId, including soft-deleted rows. */
  knownReactionWrapIds: ReadonlySet<string>;
  messages: readonly LocalNostrMessage[];
  myPubkey: string;
  /** Live (non-deleted) reaction rows. */
  reactions: readonly LocalNostrReaction[];
  softDeleteLocalNostrReactionsByWrapIds: (wrapIds: readonly string[]) => void;
  state: ReactionInboxSessionState;
  updateLocalNostrReaction: UpdateLocalNostrReaction;
}

const reactorOf = (
  event: DeferrableReactionEvent,
  ctx: ReactionInboxContext,
): string => (event._tag === "ReactionAdded" ? event.from : ctx.myPubkey);

const applyReaction = (
  event: DeferrableReactionEvent,
  ctx: ReactionInboxContext,
): "done" | "deferred" => {
  const reactorPubkey = reactorOf(event, ctx);
  if (event._tag === "ReactionAdded" && ctx.isBlockedPubkey(event.from)) {
    return "done";
  }
  if (ctx.identitySinceSec !== null && event.sentAt < ctx.identitySinceSec) {
    return "done";
  }
  if (ctx.state.retractedReactions.get(event.reactionId) === reactorPubkey) {
    return "done";
  }

  const rowByWrapId = ctx.reactions.find(
    (row) => trimString(row.wrapId) === event.reactionId,
  );
  if (rowByWrapId) {
    if ((rowByWrapId.status ?? "sent") === "pending") {
      ctx.updateLocalNostrReaction(rowByWrapId.id, { status: "sent" });
    }
    return "done";
  }
  // Soft-deleted rows are absent from `reactions` but keep their wrapId here.
  if (ctx.knownReactionWrapIds.has(event.reactionId)) return "done";

  const clientId =
    event._tag === "OwnReactionConfirmed" ? event.clientId : null;
  if (clientId !== null) {
    const rowByClientId = ctx.reactions.find(
      (row) => trimString(row.clientId) === clientId,
    );
    if (rowByClientId) {
      ctx.updateLocalNostrReaction(rowByClientId.id, {
        emoji: event.emoji,
        messageId: event.target,
        reactorPubkey,
        status: "sent",
        wrapId: event.reactionId,
      });
      return "done";
    }
  }

  const isDuplicate = ctx.reactions.some(
    (row) =>
      trimString(row.messageId) === event.target &&
      trimString(row.reactorPubkey) === reactorPubkey &&
      trimString(row.emoji) === event.emoji,
  );
  if (isDuplicate) return "done";

  const targetIsLocal = ctx.messages.some(
    (message) => trimString(message.rumorId) === event.target,
  );
  if (!targetIsLocal) return "deferred";

  ctx.appendLocalNostrReaction({
    createdAtSec: event.sentAt,
    emoji: event.emoji,
    messageId: event.target,
    reactorPubkey,
    status: "sent",
    wrapId: event.reactionId,
    ...(clientId !== null ? { clientId } : {}),
  });
  return "done";
};

const deferReaction = (
  state: ReactionInboxSessionState,
  event: DeferrableReactionEvent,
): void => {
  state.deferredReactions.set(event.reactionId, event);
  if (state.deferredReactions.size <= MAX_DEFERRED_REACTIONS) return;
  const oldestReactionId = state.deferredReactions.keys().next().value;
  if (oldestReactionId !== undefined) {
    state.deferredReactions.delete(oldestReactionId);
  }
};

const applyRetraction = (
  reactionIds: readonly string[],
  retractor: string,
  ctx: ReactionInboxContext,
): void => {
  const ownedIds: string[] = [];
  for (const reactionId of reactionIds) {
    ctx.state.retractedReactions.set(reactionId, retractor);
    const deferred = ctx.state.deferredReactions.get(reactionId);
    if (deferred !== undefined && reactorOf(deferred, ctx) === retractor) {
      ctx.state.deferredReactions.delete(reactionId);
    }
    const owned = ctx.reactions.some(
      (row) =>
        trimString(row.wrapId) === reactionId &&
        trimString(row.reactorPubkey) === retractor,
    );
    if (owned) ownedIds.push(reactionId);
  }
  if (ownedIds.length > 0) {
    ctx.softDeleteLocalNostrReactionsByWrapIds(ownedIds);
  }
};

export const processReactionInboxEvent = (
  event: ReactionInboxEvent,
  ctx: ReactionInboxContext,
): void => {
  switch (event._tag) {
    case "ReactionAdded":
    case "OwnReactionConfirmed":
      if (applyReaction(event, ctx) === "deferred") {
        deferReaction(ctx.state, event);
      }
      return;
    case "ReactionRetracted":
      applyRetraction(event.reactionIds, event.from, ctx);
      return;
    case "OwnRetractionConfirmed":
      applyRetraction(event.reactionIds, ctx.myPubkey, ctx);
      return;
  }
};

export const retryDeferredReactions = (ctx: ReactionInboxContext): void => {
  if (ctx.state.deferredReactions.size === 0) return;
  const pending = [...ctx.state.deferredReactions.values()];
  ctx.state.deferredReactions.clear();
  for (const event of pending) {
    if (applyReaction(event, ctx) === "deferred") {
      deferReaction(ctx.state, event);
    }
  }
};
