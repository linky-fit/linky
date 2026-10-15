import type {
  OwnReactionConfirmed,
  OwnRetractionConfirmed,
  Pubkey,
  ReactionAdded,
  ReactionRetracted,
  RumorId,
} from "@linky-fit/linkstr";
import { isPubkey, isRumorId } from "@linky-fit/linkstr";
import { allWrites, NO_WRITE, type WriteOutcome } from "../../lib/storeWrite";
import type {
  AppendLocalNostrReaction,
  LocalNostrMessage,
  LocalNostrReaction,
  UpdateLocalNostrReaction,
} from "../../types/appTypes";
import { trimString } from "../../../utils/validation";

const MAX_DEFERRED_REACTIONS = 1000;

export type ReactionInboxEvent =
  | ReactionAdded
  | OwnReactionConfirmed
  | ReactionRetracted
  | OwnRetractionConfirmed;

type DeferrableReactionEvent = ReactionAdded | OwnReactionConfirmed;

interface ReactionInboxSessionState {
  deferredReactions: Map<RumorId, DeferrableReactionEvent>;
  /** reactionId → retractor. Suppression is authorship-scoped: a peer's
   * retraction must not block reactions they did not author. */
  retractedReactions: Map<RumorId, Pubkey>;
}

export const createReactionInboxSessionState =
  (): ReactionInboxSessionState => ({
    deferredReactions: new Map(),
    retractedReactions: new Map(),
  });

/** A reaction by its author, since a retraction removes only the retractor's own. */
export const reactionKey = (
  reactorPubkey: Pubkey,
  reactionId: RumorId,
): string => `${reactorPubkey}/${reactionId}`;

/** `reactionKey` of a stored reaction, or null when its row holds no valid reactor or rumor id. */
export const storedReactionKey = (
  reactorPubkey: string | null,
  wrapId: string | null,
): string | null =>
  isPubkey(reactorPubkey) && isRumorId(wrapId)
    ? reactionKey(reactorPubkey, wrapId)
    : null;

export interface ReactionInboxContext {
  appendLocalNostrReaction: AppendLocalNostrReaction;
  identitySinceSec: number | null;
  isBlockedPubkey: (pubkey: string) => boolean;
  /** `reactionKey` of every stored reaction, including removed ones. */
  knownReactionKeys: ReadonlySet<string>;
  messages: readonly LocalNostrMessage[];
  myPubkey: Pubkey;
  /** Live (non-deleted) reaction rows. */
  reactions: readonly LocalNostrReaction[];
  softDeleteLocalNostrReactionsByWrapIds: (
    wrapIds: readonly string[],
  ) => Promise<WriteOutcome>;
  state: ReactionInboxSessionState;
  /** Removes the retractor's stored reaction, or records its removal so no device stores it later. */
  storeRetractedReaction: (
    reactionId: RumorId,
    retractor: Pubkey,
  ) => Promise<WriteOutcome>;
  updateLocalNostrReaction: UpdateLocalNostrReaction;
  /** See `ChatInboxContext.visibleSinceSec`. */
  visibleSinceSec: number | null;
}

const reactorOf = (
  event: DeferrableReactionEvent,
  ctx: ReactionInboxContext,
): Pubkey => (event._tag === "ReactionAdded" ? event.from : ctx.myPubkey);

/** The reaction's write, or "deferred" while its message is not stored. */
const applyReaction = (
  event: DeferrableReactionEvent,
  ctx: ReactionInboxContext,
): Promise<WriteOutcome> | "deferred" => {
  const reactorPubkey = reactorOf(event, ctx);
  if (event._tag === "ReactionAdded" && ctx.isBlockedPubkey(event.from)) {
    return NO_WRITE;
  }
  if (ctx.identitySinceSec !== null && event.sentAt < ctx.identitySinceSec) {
    return NO_WRITE;
  }
  if (ctx.visibleSinceSec !== null && event.sentAt < ctx.visibleSinceSec) {
    return NO_WRITE;
  }
  if (ctx.state.retractedReactions.get(event.reactionId) === reactorPubkey) {
    return NO_WRITE;
  }

  const rowByWrapId = ctx.reactions.find(
    (row) => trimString(row.wrapId) === event.reactionId,
  );
  if (rowByWrapId) {
    return (rowByWrapId.status ?? "sent") === "pending"
      ? ctx.updateLocalNostrReaction(rowByWrapId.id, { status: "sent" })
      : NO_WRITE;
  }
  // Removed rows are absent from `reactions` but known here.
  if (ctx.knownReactionKeys.has(reactionKey(reactorPubkey, event.reactionId)))
    return NO_WRITE;

  const clientId =
    event._tag === "OwnReactionConfirmed" ? event.clientId : null;
  if (clientId !== null) {
    const rowByClientId = ctx.reactions.find(
      (row) => trimString(row.clientId) === clientId,
    );
    if (rowByClientId) {
      return ctx.updateLocalNostrReaction(rowByClientId.id, {
        emoji: event.emoji,
        messageId: event.target,
        reactorPubkey,
        status: "sent",
        wrapId: event.reactionId,
      });
    }
  }

  const isDuplicate = ctx.reactions.some(
    (row) =>
      trimString(row.messageId) === event.target &&
      trimString(row.reactorPubkey) === reactorPubkey &&
      trimString(row.emoji) === event.emoji,
  );
  if (isDuplicate) return NO_WRITE;

  const targetIsLocal = ctx.messages.some(
    (message) => trimString(message.rumorId) === event.target,
  );
  if (!targetIsLocal) return "deferred";

  return ctx.appendLocalNostrReaction({
    createdAtSec: event.sentAt,
    emoji: event.emoji,
    messageId: event.target,
    reactorPubkey,
    status: "sent",
    wrapId: event.reactionId,
    ...(clientId !== null ? { clientId } : {}),
  }).written;
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
  reactionIds: readonly RumorId[],
  retractor: Pubkey,
  ctx: ReactionInboxContext,
): Promise<WriteOutcome> => {
  const ownedIds: string[] = [];
  const tombstones: Array<Promise<WriteOutcome>> = [];
  const storable =
    retractor === ctx.myPubkey || !ctx.isBlockedPubkey(retractor);
  for (const reactionId of reactionIds) {
    ctx.state.retractedReactions.set(reactionId, retractor);
    const deferred = ctx.state.deferredReactions.get(reactionId);
    if (deferred !== undefined && reactorOf(deferred, ctx) === retractor) {
      ctx.state.deferredReactions.delete(reactionId);
    }
    const stored = ctx.reactions.filter(
      (row) => trimString(row.wrapId) === reactionId,
    );
    if (stored.some((row) => trimString(row.reactorPubkey) === retractor)) {
      ownedIds.push(reactionId);
    } else if (
      storable &&
      stored.length === 0 &&
      !ctx.knownReactionKeys.has(reactionKey(retractor, reactionId))
    ) {
      tombstones.push(ctx.storeRetractedReaction(reactionId, retractor));
    }
  }
  return allWrites([
    ...tombstones,
    ownedIds.length > 0
      ? ctx.softDeleteLocalNostrReactionsByWrapIds(ownedIds)
      : NO_WRITE,
  ]);
};

const applyOrDefer = (
  event: DeferrableReactionEvent,
  ctx: ReactionInboxContext,
): Promise<WriteOutcome> => {
  const applied = applyReaction(event, ctx);
  if (applied !== "deferred") return applied;
  deferReaction(ctx.state, event);
  return NO_WRITE;
};

export const processReactionInboxEvent = (
  event: ReactionInboxEvent,
  ctx: ReactionInboxContext,
): Promise<WriteOutcome> => {
  switch (event._tag) {
    case "ReactionAdded":
    case "OwnReactionConfirmed":
      return applyOrDefer(event, ctx);
    case "ReactionRetracted":
      return applyRetraction(event.reactionIds, event.from, ctx);
    case "OwnRetractionConfirmed":
      return applyRetraction(event.reactionIds, ctx.myPubkey, ctx);
  }
};

/** Stores the waiting reactions whose message has arrived; resolves once they are stored. */
export const retryDeferredReactions = (
  ctx: ReactionInboxContext,
): Promise<WriteOutcome> => {
  const pending = [...ctx.state.deferredReactions.values()];
  ctx.state.deferredReactions.clear();
  return allWrites(pending.map((event) => applyOrDefer(event, ctx)));
};
