import { describe, expect, it } from "vitest";
import {
  buildMessageUpdate,
  buildReactionUpdate,
  type StoredMessageFields,
  type StoredReactionFields,
} from "./messageUpdates";

const message: StoredMessageFields = {
  clientId: null,
  content: "original",
  createdAtSec: 100,
  editedAtSec: 123,
  editedFromId: null,
  isEdited: null,
  localOnly: null,
  originalContent: null,
  pubkey: "pubkey",
  replyToContent: null,
  replyToId: "reply",
  rootMessageId: null,
  rumorId: null,
  status: "pending",
  wrapId: "pending:message",
};
const reaction: StoredReactionFields = {
  clientId: null,
  emoji: "👍",
  messageId: "message",
  reactorPubkey: "pubkey",
  status: "pending",
  wrapId: "pending:reaction",
};

describe("message updates", () => {
  it("writes an acknowledgment once, and keeps the first sent wrap", () => {
    expect(
      buildMessageUpdate(
        "message",
        { wrapId: "sent-wrap", status: "sent" },
        message,
      ),
    ).toEqual({ id: "message", wrapId: "sent-wrap", status: "sent" });
    expect(
      buildMessageUpdate(
        "message",
        { wrapId: "different-sent-wrap", status: "sent" },
        { ...message, wrapId: "sent-wrap", status: "sent" },
      ),
    ).toBeNull();
  });
  it("leaves fields that already hold the value alone", () => {
    expect(
      buildMessageUpdate(
        "message",
        { replyToId: "reply", editedAtSec: 123 },
        message,
      ),
    ).toBeNull();
    expect(
      buildMessageUpdate(
        "message",
        { replyToId: "reply", editedAtSec: 123 },
        { ...message, replyToId: null, editedAtSec: null },
      ),
    ).toEqual({ id: "message", replyToId: "reply", editedAtSec: 123 });
  });
  it("ignores empty optional values and false-only writes while retaining content whitespace", () => {
    expect(
      buildMessageUpdate(
        "message",
        {
          replyToId: null,
          content: " ",
          localOnly: false,
          isEdited: false,
          editedAtSec: null,
        },
        message,
      ),
    ).toBeNull();
    expect(
      buildMessageUpdate(
        "message",
        {
          content: "  edited  ",
          localOnly: true,
          isEdited: true,
          editedAtSec: 234,
        },
        message,
      ),
    ).toEqual({
      id: "message",
      content: "  edited  ",
      localOnly: "1",
      isEdited: "1",
      editedAtSec: 234,
    });
  });
  it("updates each reaction field and only what differs", () => {
    const updates = {
      messageId: "next-message",
      reactorPubkey: "next-pubkey",
      emoji: "🔥",
      wrapId: "sent-reaction",
      clientId: "client",
    };
    expect(buildReactionUpdate("reaction", updates, reaction)).toEqual({
      id: "reaction",
      ...updates,
    });
    expect(
      buildReactionUpdate("reaction", updates, { ...reaction, ...updates }),
    ).toBeNull();
    expect(
      buildReactionUpdate("reaction", { status: "sent" }, reaction),
    ).toEqual({ id: "reaction", status: "sent" });
  });
});
