import {
  ChatMessageReceived,
  ClientId,
  ImageBody,
  OwnChatMessageConfirmed,
  PrivateImage,
  Pubkey,
  RumorId,
  TextBody,
  UnixSeconds,
} from "@linky/linkstr";
import { getPublicKey } from "nostr-tools";
import { describe, expect, it, vi } from "vitest";
import { createSecretKey } from "../../../testUtils/nostrKeys";
import { parsePrivateImageMessage } from "../../lib/privateImageMessage";
import type {
  LocalNostrMessage,
  NewLocalNostrMessage,
} from "../../types/appTypes";
import {
  applyChatMessageReceived,
  applyOwnChatMessageConfirmed,
  type ChatInboxContext,
} from "./chatInbox";
import { buildUnknownContactId } from "./contactIdentity";

const peerPubkey = getPublicKey(createSecretKey(2));
const strangerPubkey = getPublicKey(createSecretKey(3));
const MESSAGE_RUMOR_ID = "a".repeat(64);
const EDIT_RUMOR_ID = "b".repeat(64);
const REPLY_RUMOR_ID = "d".repeat(64);
const SENT_AT = 1_700_000_100;

const received = (
  overrides: Partial<ConstructorParameters<typeof ChatMessageReceived>[0]> = {},
): ChatMessageReceived =>
  new ChatMessageReceived({
    messageId: RumorId.make(MESSAGE_RUMOR_ID),
    from: Pubkey.make(peerPubkey),
    body: new TextBody({ text: "hello" }),
    replyTo: null,
    root: null,
    editOf: null,
    sentAt: UnixSeconds.make(SENT_AT),
    ...overrides,
  });

const ownConfirmed = (
  overrides: Partial<
    ConstructorParameters<typeof OwnChatMessageConfirmed>[0]
  > = {},
): OwnChatMessageConfirmed =>
  new OwnChatMessageConfirmed({
    messageId: RumorId.make(MESSAGE_RUMOR_ID),
    to: Pubkey.make(peerPubkey),
    body: new TextBody({ text: "hello" }),
    replyTo: null,
    root: null,
    editOf: null,
    clientId: null,
    sentAt: UnixSeconds.make(SENT_AT),
    ...overrides,
  });

interface HarnessOptions {
  blockedPubkeys?: readonly string[];
  identitySinceSec?: number | null;
  messages?: LocalNostrMessage[];
}

const createHarness = (options: HarnessOptions = {}) => {
  const messages = options.messages ?? [];
  const blockedPubkeys = new Set(options.blockedPubkeys ?? []);

  const appendLocalNostrMessage = vi.fn(
    (message: NewLocalNostrMessage): string => {
      const id = `message-${messages.length + 1}`;
      messages.push({ ...message, id, status: message.status ?? "sent" });
      return id;
    },
  );
  const updateLocalNostrMessage = vi.fn(
    (id: string, updates: Partial<LocalNostrMessage>) => {
      const message = messages.find((candidate) => candidate.id === id);
      if (message) Object.assign(message, updates);
    },
  );
  const logPayStep = vi.fn();

  const ctx: ChatInboxContext = {
    appendLocalNostrMessage,
    identitySinceSec: options.identitySinceSec ?? null,
    isBlockedPubkey: (pubkey) => blockedPubkeys.has(pubkey),
    logPayStep,
    messages,
    resolveContactId: (pubkey) => (pubkey === peerPubkey ? "contact-1" : null),
    updateLocalNostrMessage,
  };

  return {
    appendLocalNostrMessage,
    ctx,
    logPayStep,
    messages,
    updateLocalNostrMessage,
  };
};

describe("applyChatMessageReceived", () => {
  it("appends an incoming text message keyed by its rumor id", () => {
    const harness = createHarness();

    const inserted = applyChatMessageReceived(
      received({
        replyTo: RumorId.make(REPLY_RUMOR_ID),
        root: RumorId.make(REPLY_RUMOR_ID),
      }),
      harness.ctx,
    );

    expect(harness.messages[0]).toEqual(
      expect.objectContaining({
        contactId: "contact-1",
        content: "hello",
        createdAtSec: SENT_AT,
        direction: "in",
        pubkey: peerPubkey,
        replyToId: REPLY_RUMOR_ID,
        rootMessageId: REPLY_RUMOR_ID,
        rumorId: MESSAGE_RUMOR_ID,
        status: "sent",
        wrapId: MESSAGE_RUMOR_ID,
      }),
    );
    expect(inserted).toEqual({
      contactId: "contact-1",
      content: "hello",
      createdAtSec: SENT_AT,
      messageId: "message-1",
      peerPubkey,
    });
  });

  it("routes an unknown sender to the synthetic unknown-contact id", () => {
    const harness = createHarness();

    applyChatMessageReceived(
      received({ from: Pubkey.make(strangerPubkey) }),
      harness.ctx,
    );

    expect(harness.messages[0]?.contactId).toBe(
      buildUnknownContactId(strangerPubkey),
    );
  });

  it("dedupes a redelivered message by rumor id", () => {
    const harness = createHarness();

    const first = applyChatMessageReceived(received(), harness.ctx);
    const second = applyChatMessageReceived(received(), harness.ctx);

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(harness.appendLocalNostrMessage).toHaveBeenCalledTimes(1);
  });

  it("stores an image body as the serialized private-image content", () => {
    const harness = createHarness();
    const image = new PrivateImage({
      url: "https://blossom.example/blob",
      fileType: "image/jpeg",
      encryptionAlgorithm: "aes-gcm",
      key: "1".repeat(64),
      nonce: "2".repeat(24),
      encryptedSha256: "3".repeat(64),
      originalSha256: "4".repeat(64),
      encryptedSize: 1024,
      width: 640,
      height: 480,
      storageEncoding: "base64",
    });

    applyChatMessageReceived(
      received({ body: new ImageBody({ image }) }),
      harness.ctx,
    );

    expect(parsePrivateImageMessage(harness.messages[0]?.content)).toEqual(
      expect.objectContaining({
        encryptedSha256: "3".repeat(64),
        url: "https://blossom.example/blob",
        width: 640,
      }),
    );
  });

  it("applies an incoming edit to the stored original", () => {
    const harness = createHarness({
      messages: [
        {
          contactId: "contact-1",
          content: "hello",
          createdAtSec: SENT_AT - 10,
          direction: "in",
          id: "message-original",
          pubkey: peerPubkey,
          rumorId: MESSAGE_RUMOR_ID,
          status: "sent",
          wrapId: MESSAGE_RUMOR_ID,
        },
      ],
    });

    const inserted = applyChatMessageReceived(
      received({
        messageId: RumorId.make(EDIT_RUMOR_ID),
        body: new TextBody({ text: "hello, edited" }),
        editOf: RumorId.make(MESSAGE_RUMOR_ID),
      }),
      harness.ctx,
    );

    expect(inserted).toBeNull();
    expect(harness.appendLocalNostrMessage).not.toHaveBeenCalled();
    expect(harness.messages[0]).toEqual(
      expect.objectContaining({
        content: "hello, edited",
        editedAtSec: SENT_AT,
        editedFromId: MESSAGE_RUMOR_ID,
        isEdited: true,
        originalContent: "hello",
        rumorId: MESSAGE_RUMOR_ID,
      }),
    );
  });

  it("does not roll back a newer edit on backfill replay", () => {
    const harness = createHarness({
      messages: [
        {
          contactId: "contact-1",
          content: "hello, newest",
          createdAtSec: SENT_AT - 10,
          direction: "in",
          editedAtSec: SENT_AT + 50,
          editedFromId: MESSAGE_RUMOR_ID,
          id: "message-original",
          isEdited: true,
          pubkey: peerPubkey,
          rumorId: MESSAGE_RUMOR_ID,
          status: "sent",
          wrapId: MESSAGE_RUMOR_ID,
        },
      ],
    });

    applyChatMessageReceived(
      received({
        messageId: RumorId.make(EDIT_RUMOR_ID),
        body: new TextBody({ text: "hello, older edit" }),
        editOf: RumorId.make(MESSAGE_RUMOR_ID),
      }),
      harness.ctx,
    );

    expect(harness.updateLocalNostrMessage).not.toHaveBeenCalled();
    expect(harness.messages[0]?.content).toBe("hello, newest");
  });

  it("appends an edit whose original never arrived, keyed by the original id", () => {
    const harness = createHarness();

    applyChatMessageReceived(
      received({
        messageId: RumorId.make(EDIT_RUMOR_ID),
        body: new TextBody({ text: "hello, edited" }),
        editOf: RumorId.make(MESSAGE_RUMOR_ID),
      }),
      harness.ctx,
    );

    expect(harness.messages[0]).toEqual(
      expect.objectContaining({
        content: "hello, edited",
        editedFromId: MESSAGE_RUMOR_ID,
        isEdited: true,
        rumorId: MESSAGE_RUMOR_ID,
        wrapId: EDIT_RUMOR_ID,
      }),
    );
  });

  it("backfills the original content when the original arrives after the edit", () => {
    const harness = createHarness({
      messages: [
        {
          contactId: "contact-1",
          content: "hello, edited",
          createdAtSec: SENT_AT,
          direction: "in",
          editedFromId: MESSAGE_RUMOR_ID,
          id: "message-edited",
          isEdited: true,
          pubkey: peerPubkey,
          rumorId: MESSAGE_RUMOR_ID,
          status: "sent",
          wrapId: EDIT_RUMOR_ID,
        },
      ],
    });

    applyChatMessageReceived(received(), harness.ctx);

    expect(harness.appendLocalNostrMessage).not.toHaveBeenCalled();
    expect(harness.messages[0]?.originalContent).toBe("hello");
  });

  it("drops blocked senders and pre-identity-switch messages", () => {
    const blocked = createHarness({ blockedPubkeys: [peerPubkey] });
    applyChatMessageReceived(received(), blocked.ctx);
    expect(blocked.appendLocalNostrMessage).not.toHaveBeenCalled();

    const cutoff = createHarness({ identitySinceSec: SENT_AT + 1 });
    applyChatMessageReceived(received(), cutoff.ctx);
    expect(cutoff.appendLocalNostrMessage).not.toHaveBeenCalled();
  });
});

describe("applyOwnChatMessageConfirmed", () => {
  const pendingRow = (
    overrides: Partial<LocalNostrMessage> = {},
  ): LocalNostrMessage => ({
    clientId: "message-client",
    contactId: "contact-1",
    content: "hello",
    createdAtSec: SENT_AT - 5,
    direction: "out",
    id: "message-pending",
    pubkey: "f".repeat(64),
    rumorId: null,
    status: "pending",
    wrapId: "pending:message-client",
    ...overrides,
  });

  it("reconciles a pending row by clientId and logs the ack", () => {
    const harness = createHarness({ messages: [pendingRow()] });

    applyOwnChatMessageConfirmed(
      ownConfirmed({ clientId: ClientId.make("message-client") }),
      harness.ctx,
    );

    expect(harness.appendLocalNostrMessage).not.toHaveBeenCalled();
    expect(harness.messages[0]).toEqual(
      expect.objectContaining({ rumorId: MESSAGE_RUMOR_ID, status: "sent" }),
    );
    expect(harness.logPayStep).toHaveBeenCalledWith("message-ack", {
      contactId: "contact-1",
      clientId: "message-client",
      rumorId: MESSAGE_RUMOR_ID,
    });
  });

  it("reconciles by rumor id when the clientId is unknown", () => {
    const harness = createHarness({
      messages: [pendingRow({ rumorId: MESSAGE_RUMOR_ID })],
    });

    applyOwnChatMessageConfirmed(ownConfirmed(), harness.ctx);

    expect(harness.messages[0]?.status).toBe("sent");
  });

  it("never appends when no row matches", () => {
    const harness = createHarness();

    applyOwnChatMessageConfirmed(
      ownConfirmed({ clientId: ClientId.make("message-client") }),
      harness.ctx,
    );

    expect(harness.appendLocalNostrMessage).not.toHaveBeenCalled();
    expect(harness.updateLocalNostrMessage).not.toHaveBeenCalled();
    expect(harness.messages).toHaveLength(0);
  });

  it("leaves an already-sent row untouched", () => {
    const harness = createHarness({
      messages: [pendingRow({ rumorId: MESSAGE_RUMOR_ID, status: "sent" })],
    });

    applyOwnChatMessageConfirmed(ownConfirmed(), harness.ctx);

    expect(harness.updateLocalNostrMessage).not.toHaveBeenCalled();
    expect(harness.logPayStep).not.toHaveBeenCalled();
  });
});
