import { describe, expect, it } from "vitest";
import type {
  LocalNostrMessage,
  LocalNostrReaction,
} from "../../types/appTypes";
import {
  applyMessageUpdate,
  buildMessageUpdate,
  buildReactionUpdate,
  type NostrMessageShadowState,
} from "./messageUpdates";

const message: LocalNostrMessage = {
  rumorId: null,
  id: "message",
  contactId: "contact",
  direction: "out",
  content: "original",
  pubkey: "pubkey",
  wrapId: "pending:message",
  createdAtSec: 100,
  status: "pending",
  replyToId: "reply",
  editedAtSec: 123,
};
const reaction: LocalNostrReaction = {
  id: "reaction",
  messageId: "message",
  reactorPubkey: "pubkey",
  emoji: "👍",
  wrapId: "pending:reaction",
  createdAtSec: 100,
  status: "pending",
};

describe("message updates", () => {
  it("deduplicates acknowledgments against the shadow before the read model catches up", () => {
    const shadow = {};
    expect(
      buildMessageUpdate(
        message.id,
        { wrapId: "sent-wrap", status: "sent" },
        message,
        shadow,
      ),
    ).toEqual({ id: message.id, wrapId: "sent-wrap", status: "sent" });
    expect(
      buildMessageUpdate(
        message.id,
        { wrapId: "different-sent-wrap", status: "sent" },
        message,
        shadow,
      ),
    ).toBeNull();
  });
  it("distinguishes a cleared shadow field from an absent field", () => {
    const shadow: NostrMessageShadowState = {
      replyToId: null,
      editedAtSec: null,
    };
    expect(
      buildMessageUpdate(
        message.id,
        { replyToId: "reply", editedAtSec: 123 },
        message,
        shadow,
      ),
    ).toEqual({ id: message.id, replyToId: "reply", editedAtSec: 123 });
    expect(
      buildMessageUpdate(
        message.id,
        { replyToId: "reply", editedAtSec: 123 },
        message,
        {},
      ),
    ).toBeNull();
  });
  it("ignores empty optional values and false-only writes while retaining content whitespace", () => {
    expect(
      buildMessageUpdate(
        message.id,
        {
          replyToId: null,
          content: " ",
          localOnly: false,
          isEdited: false,
          editedAtSec: null,
        },
        message,
        {},
      ),
    ).toBeNull();
    const payload = buildMessageUpdate(
      message.id,
      {
        content: "  edited  ",
        localOnly: true,
        isEdited: true,
        editedAtSec: 234,
      },
      message,
      {},
    );
    expect(payload).toEqual({
      id: message.id,
      content: "  edited  ",
      localOnly: "1",
      isEdited: "1",
      editedAtSec: 234,
    });
    expect(payload && applyMessageUpdate(message, payload)).toMatchObject({
      content: "  edited  ",
      localOnly: true,
      isEdited: true,
      editedAtSec: 234,
    });
  });
  it("applies nullable overlay updates without losing other message fields", () => {
    expect(
      applyMessageUpdate(
        { ...message, clientId: "client", localOnly: true },
        {
          id: message.id,
          clientId: null,
          pubkey: null,
          replyToId: null,
          localOnly: null,
        },
      ),
    ).toEqual({ ...message, pubkey: "", replyToId: null, localOnly: false });
  });
  it("updates each reaction field and suppresses the repeated delivery", () => {
    const shadow = {};
    const updates = {
      messageId: "next-message",
      reactorPubkey: "next-pubkey",
      emoji: "🔥",
      wrapId: "sent-reaction",
      clientId: "client",
    };
    expect(buildReactionUpdate(reaction.id, updates, reaction, shadow)).toEqual(
      { id: reaction.id, ...updates },
    );
    expect(
      buildReactionUpdate(reaction.id, updates, reaction, shadow),
    ).toBeNull();
    expect(
      buildReactionUpdate(reaction.id, { status: "sent" }, reaction, shadow),
    ).toEqual({ id: reaction.id, status: "sent" });
  });
});
