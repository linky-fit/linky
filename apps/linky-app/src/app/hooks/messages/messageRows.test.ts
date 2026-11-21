import {
  createId,
  directConversationIdFor,
  OwnerId,
  type ConversationRecord,
  type MessageRecord,
} from "@linky-fit/linksync";
import { describe, expect, it } from "vitest";
import {
  contactIdByConversationId,
  localMessageFrom,
  normalizeLegacyLocalMessage,
  toLocalNostrMessage,
  toMessagePatch,
  toMessageWriteRow,
  toReactionPatch,
  toReactionWriteRow,
} from "./messageRows";

const system = {
  ownerId: OwnerId.orThrow("AAAAAAAAAAAAAAAAAAAAAA"),
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const contactId = createId<"Contact">();
const conversationId = directConversationIdFor(contactId);

const messageRow = (overrides: Partial<MessageRecord> = {}): MessageRecord => ({
  id: createId<"Message">(),
  conversationId,
  direction: "in",
  content: "hello",
  wrapId: "wrap-1",
  rumorId: null,
  pubkey: null,
  createdAtSec: 1_700_000_000,
  clientId: null,
  status: null,
  localOnly: null,
  replyToId: null,
  replyToContent: null,
  rootMessageId: null,
  editedAtSec: null,
  editedFromId: null,
  isEdited: null,
  originalContent: null,
  deletedAtSec: null,
  ...system,
  ...overrides,
});

describe("contactIdByConversationId", () => {
  it("maps through the conversation rows and derives the rest from the contacts", () => {
    const other = createId<"Contact">();
    const conversation: ConversationRecord = {
      id: createId<"Conversation">(),
      kind: "direct",
      contactId: other,
      participantsJson: null,
      archivedAtSec: null,
      lastSeenAtSec: null,
      peerSeenSinceSec: null,
      peerSeenAtSec: null,
      ...system,
    };
    const map = contactIdByConversationId([conversation], [{ id: contactId }]);
    expect(map.get(conversation.id)).toBe(other);
    expect(map.get(conversationId)).toBe(contactId);
  });
});

describe("toLocalNostrMessage", () => {
  it("reads a row into the UI shape and drops one without a contact", () => {
    const row = messageRow({
      clientId: "client-1",
      isEdited: "1",
      status: "pending",
    });
    expect(toLocalNostrMessage(row, contactId)).toMatchObject({
      id: row.id,
      contactId,
      direction: "in",
      content: "hello",
      clientId: "client-1",
      isEdited: true,
      status: "pending",
      localOnly: false,
    });
    expect(toLocalNostrMessage(row, undefined)).toBeNull();
  });

  it("leaves the status unknown while its column has not synced", () => {
    const message = toLocalNostrMessage(
      messageRow({ status: null }),
      contactId,
    );
    expect(message).not.toBeNull();
    expect(message).not.toHaveProperty("status");
  });
});

describe("write rows", () => {
  it("builds a message row with the branded columns and omits what is absent", () => {
    const id = createId<"Message">();
    const row = toMessageWriteRow(
      id,
      conversationId,
      {
        contactId,
        direction: "out",
        content: "hi there",
        wrapId: "",
        rumorId: "rumor-1",
        pubkey: "",
        createdAtSec: 1_700_000_001,
        status: "pending",
        localOnly: true,
        replyToId: null,
        replyToContent: null,
        rootMessageId: null,
        editedAtSec: null,
        editedFromId: null,
        isEdited: false,
        originalContent: null,
        deletedAtSec: null,
      },
      "pending:local-1",
    );
    expect(row).toEqual({
      id,
      conversationId,
      direction: "out",
      content: "hi there",
      wrapId: "pending:local-1",
      createdAtSec: 1_700_000_001,
      status: "pending",
      rumorId: "rumor-1",
      localOnly: "1",
    });
  });

  it("keeps the deletion of a message stored as a placeholder", () => {
    const row = toMessageWriteRow(
      createId<"Message">(),
      conversationId,
      {
        contactId,
        direction: "in",
        content: "[deleted]",
        wrapId: "",
        rumorId: "rumor-1",
        pubkey: "peer",
        createdAtSec: 1_700_000_001,
        deletedAtSec: 1_700_000_001,
      },
      "rumor-1",
    );
    expect(row).toMatchObject({ deletedAtSec: 1_700_000_001 });
  });

  it("rejects a message without content and a reaction without a target", () => {
    expect(
      toMessageWriteRow(
        createId<"Message">(),
        conversationId,
        {
          contactId,
          direction: "in",
          content: "   ",
          wrapId: "w",
          rumorId: null,
          pubkey: "",
          createdAtSec: 1,
        },
        "w",
      ),
    ).toBeNull();
    expect(
      toReactionWriteRow(
        createId<"Reaction">(),
        conversationId,
        {
          messageId: "",
          reactorPubkey: "pk",
          emoji: "x",
          wrapId: "w",
          createdAtSec: 1,
        },
        "w",
      ),
    ).toBeNull();
  });

  it("builds a reaction row", () => {
    const id = createId<"Reaction">();
    expect(
      toReactionWriteRow(
        id,
        conversationId,
        {
          messageId: "rumor-1",
          reactorPubkey: "pk",
          emoji: "👍",
          wrapId: "wrap-r",
          createdAtSec: 5,
          clientId: "c",
        },
        "wrap-r",
      ),
    ).toEqual({
      id,
      conversationId,
      messageId: "rumor-1",
      reactorPubkey: "pk",
      emoji: "👍",
      wrapId: "wrap-r",
      createdAtSec: 5,
      status: "sent",
      clientId: "c",
    });
  });
});

describe("patches", () => {
  it("decodes the named columns, keeps explicit nulls and drops empty text", () => {
    expect(
      toMessagePatch({
        id: "m",
        content: "edited",
        clientId: null,
        rumorId: "",
        status: "sent",
        editedAtSec: 12,
        isEdited: "1",
      }),
    ).toEqual({
      clientId: null,
      content: "edited",
      status: "sent",
      editedAtSec: 12,
      isEdited: "1",
    });
    expect(toReactionPatch({ id: "r", wrapId: "w2", status: "sent" })).toEqual({
      wrapId: "w2",
      status: "sent",
    });
  });

  it("drops unsafe integer timestamps so Evolu PositiveInt validation never rejects the row", () => {
    const unsafeSec = Number.MAX_SAFE_INTEGER + 2;
    expect(
      toMessageWriteRow(
        createId<"Message">(),
        conversationId,
        {
          contactId,
          direction: "in",
          content: "hi",
          wrapId: "wrap-unsafe",
          rumorId: null,
          pubkey: "",
          createdAtSec: unsafeSec,
        },
        "wrap-unsafe",
      ),
    ).toBeNull();
    const row = toMessageWriteRow(
      createId<"Message">(),
      conversationId,
      {
        contactId,
        direction: "in",
        content: "hi",
        wrapId: "wrap-unsafe-opt",
        rumorId: null,
        pubkey: "",
        createdAtSec: 1_700_000_001,
        editedAtSec: unsafeSec,
        deletedAtSec: unsafeSec,
      },
      "wrap-unsafe-opt",
    );
    expect(row).not.toBeNull();
    expect(row?.editedAtSec).toBeUndefined();
    expect(row?.deletedAtSec).toBeUndefined();
    expect(
      toMessagePatch({
        id: "m",
        editedAtSec: unsafeSec,
      }),
    ).toEqual({ editedAtSec: null });
  });
});

describe("local messages", () => {
  it("keeps the id and wrap a row got", () => {
    const local = localMessageFrom(
      {
        contactId,
        direction: "in",
        content: "x",
        wrapId: "",
        rumorId: null,
        pubkey: "",
        createdAtSec: 3,
      },
      "id-1",
      "pending:1",
    );
    expect(local).toMatchObject({ id: "id-1", wrapId: "pending:1" });
  });

  it("normalizes a legacy localStorage record and invents a wrap for one without", () => {
    const legacy = normalizeLegacyLocalMessage({
      contactId,
      direction: "out",
      content: "old",
      createdAtSec: "7",
    });
    expect(legacy?.wrapId.startsWith("legacy:")).toBe(true);
    expect(legacy?.createdAtSec).toBe(7);
    expect(normalizeLegacyLocalMessage({ direction: "out" })).toBeNull();
  });
});
