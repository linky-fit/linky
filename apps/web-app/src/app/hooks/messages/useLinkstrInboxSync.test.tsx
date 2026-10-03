import {
  ChatMessageReceived,
  Emoji,
  Pubkey,
  ReactionAdded,
  ReactionRetracted,
  RumorId,
  TextBody,
  UnixSeconds,
  type InboxDelivery,
  type WrapInboxEvent,
} from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { Effect } from "effect";
import { nsecEncode } from "nostr-tools/nip19";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import { NO_WRITE, runWrite, type WriteOutcome } from "../../lib/storeWrite";
import type {
  LocalNostrMessage,
  NewLocalNostrMessage,
  NewLocalNostrReaction,
} from "../../types/appTypes";

interface Handler {
  readonly onEvent: (
    event: WrapInboxEvent,
    delivery: InboxDelivery,
  ) => void | Promise<void>;
}

const { handlerRef } = vi.hoisted(() => {
  const ref: { current: Handler | null } = { current: null };
  return { handlerRef: ref };
});

vi.mock("@linky-fit/linkstr-react", () => ({
  wrapInboxAtom: "inbox",
  wrapInboxHandlerAtom: "handler",
  useAtomMount: () => {},
  useAtomSet: () => (handler: Handler | null) => {
    handlerRef.current = handler;
  },
}));

import { useLinkstrInboxSync } from "./useLinkstrInboxSync";

const me = makeIdentity();
const peer = makeIdentity();
const TARGET = RumorId.make("a".repeat(64));
const sentAt = UnixSeconds.make(Math.floor(Date.now() / 1000) - 60);

const message = new ChatMessageReceived({
  messageId: TARGET,
  from: Pubkey.make(peer.pubkey),
  body: new TextBody({ text: "hello" }),
  replyTo: null,
  root: null,
  editOf: null,
  clientId: null,
  sentAt,
});

const reaction = new ReactionAdded({
  reactionId: RumorId.make("b".repeat(64)),
  target: TARGET,
  from: Pubkey.make(peer.pubkey),
  emoji: Emoji.make("👍"),
  sentAt,
});

/** A store write that settles when the test says so. */
const controlledWrite = () => {
  let settle: (ok: boolean) => void = () => {};
  const outcome = new Promise<boolean>((resolve) => {
    settle = resolve;
  });
  return {
    start: () =>
      runWrite(
        Effect.flatMap(
          Effect.promise(() => outcome),
          (ok) => (ok ? Effect.void : Effect.fail("quota exceeded")),
        ),
      ),
    settle: (ok: boolean) => settle(ok),
  };
};

type Write = () => Promise<WriteOutcome>;

const render = async (writes: {
  message?: Write;
  reaction?: Write;
  retraction?: Write;
}) => {
  const messagesRef: React.MutableRefObject<LocalNostrMessage[]> = {
    current: [],
  };
  const storedReactions: Array<NewLocalNostrReaction> = [];
  const appendLocalNostrMessage = (stored: NewLocalNostrMessage) => {
    const written = writes.message?.() ?? NO_WRITE;
    messagesRef.current = [
      ...messagesRef.current,
      { ...stored, id: `message-${messagesRef.current.length}` },
    ];
    return { id: "message-id", written };
  };
  const appendLocalNostrReaction = (stored: NewLocalNostrReaction) => {
    const written = writes.reaction?.() ?? NO_WRITE;
    storedReactions.push(stored);
    return { id: "reaction-id", written };
  };
  const Probe = () => {
    useLinkstrInboxSync({
      advanceContactPeerSeen: () => NO_WRITE,
      appendLocalNostrMessage,
      appendLocalNostrReaction,
      applyBankPaymentOfferSnapshot: () => [],
      contacts: [],
      currentNsec: nsecEncode(me.secretKey),
      enabled: true,
      formatDisplayedAmountText: String,
      getPeerSeenWindow: () => null,
      handleSupporterResult: async () => ({ ok: true }),
      logPayStep: () => {},
      maybeShowPwaNotification: () => Promise.resolve(),
      messagesVisibleSinceSec: null,
      nostrMessagesLatestRef: messagesRef,
      nostrMessagesLocal: [],
      knownReactionKeysRef: { current: new Set() },
      nostrReactionsLocal: [],
      onOpenInboxMessageToast: () => {},
      pushToast: () => {},
      recordSentSeenReceipt: () => {},
      route: { kind: "contacts" },
      softDeleteLocalNostrReactionsByWrapIds: () => NO_WRITE,
      storeRetractedReaction: () => writes.retraction?.() ?? NO_WRITE,
      t: (key: string) => key,
      updateLocalNostrMessage: () => NO_WRITE,
      updateLocalNostrReaction: () => NO_WRITE,
    });
    return null;
  };
  await renderIntoDocument(<Probe />);
  const handler = handlerRef.current;
  if (handler === null) throw new Error("inbox handler not registered");
  return { handler, storedReactions };
};

const state = async (promise: Promise<void>) =>
  Promise.race([
    promise.then(
      () => "stored",
      () => "failed",
    ),
    new Promise((resolve) => setTimeout(() => resolve("pending"), 10)),
  ]);

describe("useLinkstrInboxSync", () => {
  beforeEach(() => {
    handlerRef.current = null;
    localStorage.clear();
  });

  it("confirms an event only once the writes it started have finished", async () => {
    const stored = controlledWrite();
    const { handler } = await render({ message: stored.start });

    const confirmed = Promise.resolve(handler.onEvent(message, "backfill"));
    expect(await state(confirmed)).toBe("pending");
    stored.settle(true);
    expect(await state(confirmed)).toBe("stored");
  });

  it("leaves an event unconfirmed when its write fails", async () => {
    const stored = controlledWrite();
    const { handler } = await render({ message: stored.start });

    const confirmed = Promise.resolve(handler.onEvent(message, "backfill"));
    stored.settle(false);
    expect(await state(confirmed)).toBe("failed");
  });

  it("confirms a retraction of a reaction not stored yet once its removal is stored", async () => {
    const removal = controlledWrite();
    const { handler } = await render({ retraction: removal.start });

    const confirmed = Promise.resolve(
      handler.onEvent(
        new ReactionRetracted({
          reactionIds: [reaction.reactionId],
          from: Pubkey.make(peer.pubkey),
          sentAt,
        }),
        "backfill",
      ),
    );
    expect(await state(confirmed)).toBe("pending");
    removal.settle(true);
    expect(await state(confirmed)).toBe("stored");
  });

  it("stores a reaction waiting for its message before confirming the message", async () => {
    const reactionWrite = controlledWrite();
    const { handler, storedReactions } = await render({
      reaction: reactionWrite.start,
    });

    expect(
      await state(Promise.resolve(handler.onEvent(reaction, "backfill"))),
    ).toBe("stored");
    expect(storedReactions).toEqual([]);

    const confirmed = Promise.resolve(handler.onEvent(message, "backfill"));
    expect(storedReactions).toEqual([
      expect.objectContaining({ messageId: TARGET, emoji: "👍" }),
    ]);
    expect(await state(confirmed)).toBe("pending");
    reactionWrite.settle(true);
    expect(await state(confirmed)).toBe("stored");
  });
});
