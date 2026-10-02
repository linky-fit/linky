import {
  ClientId,
  Emoji,
  OwnReactionConfirmed,
  OwnRetractionConfirmed,
  Pubkey,
  ReactionAdded,
  ReactionRetracted,
  RumorId,
  UnixSeconds,
} from "@linky-fit/linkstr";
import { getPublicKey } from "nostr-tools";
import { describe, expect, it, vi } from "vitest";
import { createSecretKey } from "../../../testUtils/nostrKeys";
import { NO_WRITE } from "../../lib/storeWrite";
import type {
  LocalNostrMessage,
  LocalNostrReaction,
  NewLocalNostrReaction,
} from "../../types/appTypes";
import {
  createReactionInboxSessionState,
  processReactionInboxEvent,
  reactionKey,
  retryDeferredReactions,
  storedReactionKey,
  type ReactionInboxContext,
} from "./reactionInbox";

const myPubkey = Pubkey.make(getPublicKey(createSecretKey(1)));
const peerPubkey = Pubkey.make(getPublicKey(createSecretKey(2)));
const otherPubkey = Pubkey.make(getPublicKey(createSecretKey(3)));
const TARGET_RUMOR_ID = RumorId.make("a".repeat(64));
const REACTION_ID = RumorId.make("b".repeat(64));
const SENT_AT = 1_700_000_010;

const createStoredMessage = (
  overrides: Partial<LocalNostrMessage> = {},
): LocalNostrMessage => ({
  contactId: "contact-1",
  content: "hello",
  createdAtSec: 1_700_000_000,
  direction: "in",
  id: "stored-message",
  pubkey: peerPubkey,
  rumorId: TARGET_RUMOR_ID,
  status: "sent",
  wrapId: "c".repeat(64),
  ...overrides,
});

const reactionAdded = (
  overrides: Partial<ConstructorParameters<typeof ReactionAdded>[0]> = {},
): ReactionAdded =>
  new ReactionAdded({
    reactionId: RumorId.make(REACTION_ID),
    target: RumorId.make(TARGET_RUMOR_ID),
    from: Pubkey.make(peerPubkey),
    emoji: Emoji.make("👍"),
    sentAt: UnixSeconds.make(SENT_AT),
    ...overrides,
  });

const ownReactionConfirmed = (
  overrides: Partial<
    ConstructorParameters<typeof OwnReactionConfirmed>[0]
  > = {},
): OwnReactionConfirmed =>
  new OwnReactionConfirmed({
    reactionId: RumorId.make(REACTION_ID),
    target: RumorId.make(TARGET_RUMOR_ID),
    emoji: Emoji.make("👍"),
    clientId: null,
    sentAt: UnixSeconds.make(SENT_AT),
    ...overrides,
  });

interface HarnessOptions {
  blockedPubkeys?: readonly string[];
  identitySinceSec?: number | null;
  visibleSinceSec?: number | null;
  messages?: LocalNostrMessage[];
  reactions?: LocalNostrReaction[];
}

const createHarness = (options: HarnessOptions = {}) => {
  const messages = options.messages ?? [];
  const reactions = options.reactions ?? [];
  const knownReactionKeys = new Set(
    reactions.flatMap(
      (reaction) =>
        storedReactionKey(reaction.reactorPubkey, reaction.wrapId) ?? [],
    ),
  );
  const softDeleted: string[][] = [];
  const storedRetractions: Array<[string, string]> = [];
  const blockedPubkeys = new Set(options.blockedPubkeys ?? []);

  const appendLocalNostrReaction = vi.fn((reaction: NewLocalNostrReaction) => {
    const id = `reaction-${reactions.length + 1}`;
    reactions.push({ ...reaction, id, status: reaction.status ?? "sent" });
    const key = storedReactionKey(reaction.reactorPubkey, reaction.wrapId);
    if (key !== null) knownReactionKeys.add(key);
    return { id, written: NO_WRITE };
  });
  const updateLocalNostrReaction = vi.fn(
    (id: string, updates: Partial<LocalNostrReaction>) => {
      const reaction = reactions.find((candidate) => candidate.id === id);
      if (reaction) Object.assign(reaction, updates);
      const key =
        reaction && updates.wrapId
          ? storedReactionKey(reaction.reactorPubkey, updates.wrapId)
          : null;
      if (key !== null) knownReactionKeys.add(key);
      return NO_WRITE;
    },
  );
  const softDeleteLocalNostrReactionsByWrapIds = vi.fn(
    (wrapIds: readonly string[]) => {
      softDeleted.push([...wrapIds]);
      for (const wrapId of wrapIds) {
        const index = reactions.findIndex(
          (reaction) => reaction.wrapId === wrapId,
        );
        if (index !== -1) reactions.splice(index, 1);
      }
      return NO_WRITE;
    },
  );

  const ctx: ReactionInboxContext = {
    appendLocalNostrReaction,
    identitySinceSec: options.identitySinceSec ?? null,
    isBlockedPubkey: (pubkey) => blockedPubkeys.has(pubkey),
    knownReactionKeys,
    messages,
    myPubkey,
    reactions,
    softDeleteLocalNostrReactionsByWrapIds,
    state: createReactionInboxSessionState(),
    storeRetractedReaction: (reactionId, retractor) => {
      storedRetractions.push([reactionId, retractor]);
      knownReactionKeys.add(reactionKey(retractor, reactionId));
      return NO_WRITE;
    },
    updateLocalNostrReaction,
    visibleSinceSec: options.visibleSinceSec ?? null,
  };

  return {
    appendLocalNostrReaction,
    ctx,
    knownReactionKeys,
    messages,
    reactions,
    softDeleted,
    storedRetractions,
    updateLocalNostrReaction,
  };
};

describe("processReactionInboxEvent", () => {
  it("inserts a foreign reaction for a local message", () => {
    const harness = createHarness({ messages: [createStoredMessage()] });

    processReactionInboxEvent(reactionAdded(), harness.ctx);

    expect(harness.appendLocalNostrReaction).toHaveBeenCalledTimes(1);
    expect(harness.reactions[0]).toEqual(
      expect.objectContaining({
        createdAtSec: SENT_AT,
        emoji: "👍",
        messageId: TARGET_RUMOR_ID,
        reactorPubkey: peerPubkey,
        status: "sent",
        wrapId: REACTION_ID,
      }),
    );
  });

  it("reconciles an own echo to the pending row by clientId", () => {
    const pending: LocalNostrReaction = {
      clientId: "reaction-client",
      createdAtSec: 1_700_000_000,
      emoji: "👍",
      id: "pending-reaction",
      messageId: TARGET_RUMOR_ID,
      reactorPubkey: myPubkey,
      status: "pending",
      wrapId: "pending:reaction-client",
    };
    const harness = createHarness({
      messages: [createStoredMessage()],
      reactions: [pending],
    });

    processReactionInboxEvent(
      ownReactionConfirmed({ clientId: ClientId.make("reaction-client") }),
      harness.ctx,
    );

    expect(harness.appendLocalNostrReaction).not.toHaveBeenCalled();
    expect(pending).toEqual(
      expect.objectContaining({
        emoji: "👍",
        messageId: TARGET_RUMOR_ID,
        reactorPubkey: myPubkey,
        status: "sent",
        wrapId: REACTION_ID,
      }),
    );
  });

  it("flips a pending row matched by wrapId to sent", () => {
    // A failed send stores the rumor id as the row's wrapId for exactly this
    // reconciliation.
    const pending: LocalNostrReaction = {
      clientId: "reaction-client",
      createdAtSec: 1_700_000_000,
      emoji: "👍",
      id: "pending-reaction",
      messageId: TARGET_RUMOR_ID,
      reactorPubkey: myPubkey,
      status: "pending",
      wrapId: REACTION_ID,
    };
    const harness = createHarness({
      messages: [createStoredMessage()],
      reactions: [pending],
    });

    processReactionInboxEvent(ownReactionConfirmed(), harness.ctx);

    expect(harness.appendLocalNostrReaction).not.toHaveBeenCalled();
    expect(harness.updateLocalNostrReaction).toHaveBeenCalledWith(
      "pending-reaction",
      { status: "sent" },
    );
  });

  it("suppresses a duplicate (message, reactor, emoji) reaction", () => {
    const harness = createHarness({ messages: [createStoredMessage()] });

    processReactionInboxEvent(reactionAdded(), harness.ctx);
    processReactionInboxEvent(
      reactionAdded({ reactionId: RumorId.make("d".repeat(64)) }),
      harness.ctx,
    );

    expect(harness.appendLocalNostrReaction).toHaveBeenCalledTimes(1);
    expect(harness.reactions).toHaveLength(1);
  });

  it("soft-deletes only the retractor's rows", () => {
    const mine: LocalNostrReaction = {
      createdAtSec: 1,
      emoji: "👍",
      id: "reaction-mine",
      messageId: TARGET_RUMOR_ID,
      reactorPubkey: peerPubkey,
      wrapId: REACTION_ID,
    };
    const someoneElses: LocalNostrReaction = {
      createdAtSec: 2,
      emoji: "❤️",
      id: "reaction-other",
      messageId: TARGET_RUMOR_ID,
      reactorPubkey: otherPubkey,
      wrapId: "d".repeat(64),
    };
    const harness = createHarness({
      messages: [createStoredMessage()],
      reactions: [mine, someoneElses],
    });

    processReactionInboxEvent(
      new ReactionRetracted({
        reactionIds: [RumorId.make(REACTION_ID), RumorId.make("d".repeat(64))],
        from: Pubkey.make(peerPubkey),
        sentAt: UnixSeconds.make(SENT_AT),
      }),
      harness.ctx,
    );

    expect(harness.softDeleted).toEqual([[REACTION_ID]]);
    expect(harness.reactions).toEqual([someoneElses]);
    expect(harness.storedRetractions).toEqual([]);
  });

  it("applies an own retraction with my pubkey as the retractor", () => {
    const mine: LocalNostrReaction = {
      createdAtSec: 1,
      emoji: "👍",
      id: "reaction-mine",
      messageId: TARGET_RUMOR_ID,
      reactorPubkey: myPubkey,
      wrapId: REACTION_ID,
    };
    const harness = createHarness({
      messages: [createStoredMessage()],
      reactions: [mine],
    });

    processReactionInboxEvent(
      new OwnRetractionConfirmed({
        retractionId: RumorId.make("e".repeat(64)),
        reactionIds: [RumorId.make(REACTION_ID)],
        clientId: null,
        sentAt: UnixSeconds.make(SENT_AT),
      }),
      harness.ctx,
    );

    expect(harness.softDeleted).toEqual([[REACTION_ID]]);
  });

  it("suppresses a reaction retracted before it arrived", () => {
    const harness = createHarness({ messages: [createStoredMessage()] });

    processReactionInboxEvent(
      new ReactionRetracted({
        reactionIds: [RumorId.make(REACTION_ID)],
        from: Pubkey.make(peerPubkey),
        sentAt: UnixSeconds.make(SENT_AT),
      }),
      harness.ctx,
    );
    processReactionInboxEvent(reactionAdded(), harness.ctx);

    expect(harness.appendLocalNostrReaction).not.toHaveBeenCalled();
    expect(harness.storedRetractions).toEqual([[REACTION_ID, peerPubkey]]);
  });

  it("stores a retraction once, and not for a blocked peer", () => {
    const harness = createHarness({ blockedPubkeys: [otherPubkey] });
    const retraction = (from: string) =>
      new ReactionRetracted({
        reactionIds: [RumorId.make(REACTION_ID)],
        from: Pubkey.make(from),
        sentAt: UnixSeconds.make(SENT_AT),
      });

    processReactionInboxEvent(retraction(peerPubkey), harness.ctx);
    processReactionInboxEvent(retraction(peerPubkey), harness.ctx);
    processReactionInboxEvent(retraction(otherPubkey), harness.ctx);

    expect(harness.storedRetractions).toEqual([[REACTION_ID, peerPubkey]]);
  });

  it("does not let a peer's retraction suppress reactions they did not author", () => {
    const harness = createHarness({ messages: [createStoredMessage()] });

    processReactionInboxEvent(
      new ReactionRetracted({
        reactionIds: [RumorId.make(REACTION_ID)],
        from: Pubkey.make(peerPubkey),
        sentAt: UnixSeconds.make(SENT_AT),
      }),
      harness.ctx,
    );
    processReactionInboxEvent(ownReactionConfirmed(), harness.ctx);

    expect(harness.appendLocalNostrReaction).toHaveBeenCalledTimes(1);
    expect(harness.reactions[0]?.reactorPubkey).toBe(myPubkey);
  });

  it("keeps another author's deferred reaction through a peer's retraction", () => {
    const harness = createHarness();

    processReactionInboxEvent(ownReactionConfirmed(), harness.ctx);
    processReactionInboxEvent(
      new ReactionRetracted({
        reactionIds: [RumorId.make(REACTION_ID)],
        from: Pubkey.make(peerPubkey),
        sentAt: UnixSeconds.make(SENT_AT),
      }),
      harness.ctx,
    );

    harness.messages.push(createStoredMessage());
    retryDeferredReactions(harness.ctx);

    expect(harness.appendLocalNostrReaction).toHaveBeenCalledTimes(1);
    expect(harness.reactions[0]?.reactorPubkey).toBe(myPubkey);
  });

  it("defers a reaction until the target message arrives", () => {
    const harness = createHarness();

    processReactionInboxEvent(reactionAdded(), harness.ctx);
    expect(harness.appendLocalNostrReaction).not.toHaveBeenCalled();

    retryDeferredReactions(harness.ctx);
    expect(harness.appendLocalNostrReaction).not.toHaveBeenCalled();

    harness.messages.push(createStoredMessage());
    retryDeferredReactions(harness.ctx);

    expect(harness.appendLocalNostrReaction).toHaveBeenCalledTimes(1);
    expect(harness.ctx.state.deferredReactions.size).toBe(0);
  });

  it("does not retry a deferred reaction retracted before its message arrives", () => {
    const harness = createHarness();

    processReactionInboxEvent(reactionAdded(), harness.ctx);
    processReactionInboxEvent(
      new ReactionRetracted({
        reactionIds: [RumorId.make(REACTION_ID)],
        from: Pubkey.make(peerPubkey),
        sentAt: UnixSeconds.make(SENT_AT),
      }),
      harness.ctx,
    );

    harness.messages.push(createStoredMessage());
    retryDeferredReactions(harness.ctx);

    expect(harness.appendLocalNostrReaction).not.toHaveBeenCalled();
  });

  it("skips reactions from blocked pubkeys but not own echoes", () => {
    const harness = createHarness({
      blockedPubkeys: [peerPubkey, myPubkey],
      messages: [createStoredMessage()],
    });

    processReactionInboxEvent(reactionAdded(), harness.ctx);
    expect(harness.appendLocalNostrReaction).not.toHaveBeenCalled();

    processReactionInboxEvent(ownReactionConfirmed(), harness.ctx);
    expect(harness.appendLocalNostrReaction).toHaveBeenCalledTimes(1);
    expect(harness.reactions[0]?.reactorPubkey).toBe(myPubkey);
  });

  it("skips reactions sent before an identity switch cutoff", () => {
    const harness = createHarness({
      identitySinceSec: SENT_AT + 1,
      messages: [createStoredMessage()],
    });

    processReactionInboxEvent(reactionAdded(), harness.ctx);

    expect(harness.appendLocalNostrReaction).not.toHaveBeenCalled();
    expect(harness.ctx.state.deferredReactions.size).toBe(0);
  });

  it("stores no reaction sent before the visible shards began", () => {
    const harness = createHarness({
      visibleSinceSec: SENT_AT + 1,
      messages: [createStoredMessage()],
    });

    processReactionInboxEvent(reactionAdded(), harness.ctx);
    processReactionInboxEvent(ownReactionConfirmed(), harness.ctx);

    expect(harness.appendLocalNostrReaction).not.toHaveBeenCalled();
    expect(harness.ctx.state.deferredReactions.size).toBe(0);
  });

  it("skips a reaction whose wrapId belongs to a soft-deleted row", () => {
    const harness = createHarness({ messages: [createStoredMessage()] });
    harness.knownReactionKeys.add(reactionKey(peerPubkey, REACTION_ID));

    processReactionInboxEvent(reactionAdded(), harness.ctx);

    expect(harness.appendLocalNostrReaction).not.toHaveBeenCalled();
  });
});
