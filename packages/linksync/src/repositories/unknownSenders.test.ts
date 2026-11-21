import { Pubkey, RumorId } from "@linky-fit/linkstr";
import {
  createId,
  directConversationIdFor,
  nostrMessageIdFor,
} from "../model/ids";
import { messageContentColumns } from "../model/schema";
import { createLinkyStore } from "../model/store";
import { linkyStore, runNow } from "../testing/linky";
import { makeConversationsRepository } from "./conversations";
import { makeUnknownSendersRepository } from "./unknownSenders";

const alice = Pubkey.make("a1".repeat(32));
const bob = Pubkey.make("b0".repeat(32));
const rumor = (n: number) => RumorId.make(n.toString(16).padStart(64, "0"));

const incoming = (from: Pubkey, n: number) => ({
  id: nostrMessageIdFor(rumor(n)),
  peerPubkey: from,
  direction: "in",
  content: `hi ${n}`,
  wrapId: rumor(n),
  rumorId: rumor(n),
  pubkey: from,
  createdAtSec: n,
});

const messagesFrom = (
  unknownSenders: ReturnType<typeof makeUnknownSendersRepository>,
  sender: string,
) => runNow(unknownSenders.all).filter((row) => row.peerPubkey === sender);

describe("unknown senders repository", () => {
  it("stores a message from Nostr once and lists a sender's messages", () => {
    const { store } = linkyStore();
    const unknownSenders = makeUnknownSendersRepository(store);
    expect(runNow(unknownSenders.insertIfAbsent(incoming(alice, 1)))).toBe(
      true,
    );
    expect(runNow(unknownSenders.insertIfAbsent(incoming(alice, 1)))).toBe(
      false,
    );
    runNow(unknownSenders.insertIfAbsent(incoming(bob, 2)));
    expect(
      messagesFrom(unknownSenders, alice).map((row) => row.content),
    ).toEqual(["hi 1"]);
    expect(runNow(store.visibleShards("unknownSenders"))).toHaveLength(1);
  });

  it("moves a sender's messages into the contact's conversation under their ids", () => {
    const { store } = linkyStore();
    const unknownSenders = makeUnknownSendersRepository(store);
    const conversations = makeConversationsRepository(store);
    runNow(unknownSenders.insertIfAbsent(incoming(alice, 1)));
    runNow(unknownSenders.insertIfAbsent(incoming(alice, 2)));
    runNow(unknownSenders.insertIfAbsent(incoming(bob, 3)));
    runNow(
      unknownSenders.update(nostrMessageIdFor(rumor(2)), {
        content: "hi 2, edited",
      }),
    );
    const contactId = createId<"Contact">();

    expect(runNow(unknownSenders.moveToContact(alice, contactId))).toBe(2);

    const moved = runNow(
      conversations.messagesIn(directConversationIdFor(contactId)),
    );
    expect(moved.map((row) => [row.id, row.content])).toEqual([
      [nostrMessageIdFor(rumor(1)), "hi 1"],
      [nostrMessageIdFor(rumor(2)), "hi 2, edited"],
    ]);
    expect(moved[0]?.clientId).toBeNull();
    expect(runNow(conversations.forContact(contactId))?.kind).toBe("direct");
    expect(messagesFrom(unknownSenders, alice)).toEqual([]);
    expect(messagesFrom(unknownSenders, bob)).toHaveLength(1);
  });

  it("carries every message content column it holds onto the contact", () => {
    const { store } = linkyStore();
    const unknownSenders = makeUnknownSendersRepository(store);
    const conversations = makeConversationsRepository(store);
    runNow(
      unknownSenders.insert({
        ...incoming(alice, 1),
        clientId: "client-1",
        status: "sent",
        localOnly: "1",
        replyToId: rumor(9),
        replyToContent: "earlier",
        rootMessageId: rumor(8),
        editedAtSec: 5,
        editedFromId: rumor(7),
        isEdited: "1",
        originalContent: "hi",
        deletedAtSec: 6,
      }),
    );
    const [stored] = messagesFrom(unknownSenders, alice);
    const contactId = createId<"Contact">();

    runNow(unknownSenders.moveToContact(alice, contactId));

    const [moved] = runNow(
      conversations.messagesIn(directConversationIdFor(contactId)),
    );
    const contentOf = (row: object | undefined) =>
      Object.keys(messageContentColumns).map((column) =>
        row === undefined ? undefined : Reflect.get(row, column),
      );
    expect(contentOf(moved)).toEqual(contentOf(stored));
    expect(contentOf(moved)).not.toContain(null);
  });

  it("moves once when two devices move the same sender", () => {
    const { db, appOwner } = linkyStore();
    const deviceA = makeUnknownSendersRepository(
      createLinkyStore(db, appOwner),
    );
    const storeB = createLinkyStore(db, appOwner);
    const deviceB = makeUnknownSendersRepository(storeB);
    const contactId = createId<"Contact">();
    runNow(deviceA.insertIfAbsent(incoming(alice, 1)));
    const conversationsB = makeConversationsRepository(storeB);
    // B already holds the message from its own move whose removal has not synced.
    const { peerPubkey: _peerPubkey, ...messageColumns } = incoming(alice, 1);
    void _peerPubkey;
    runNow(
      conversationsB.messages.insertIfAbsent({
        ...messageColumns,
        content: "hi 1, edited on B",
        conversationId: directConversationIdFor(contactId),
      }),
    );

    expect(runNow(deviceA.moveToContact(alice, contactId))).toBe(1);
    expect(runNow(deviceB.moveToContact(alice, contactId))).toBe(0);

    expect(
      runNow(conversationsB.messages.all).map((row) => row.content),
    ).toEqual(["hi 1, edited on B"]);
    expect(runNow(deviceB.all)).toEqual([]);
  });

  it("removes every message of a sender", () => {
    const { store } = linkyStore();
    const unknownSenders = makeUnknownSendersRepository(store);
    runNow(unknownSenders.insertIfAbsent(incoming(alice, 1)));
    runNow(unknownSenders.insertIfAbsent(incoming(alice, 2)));
    runNow(unknownSenders.insertIfAbsent(incoming(bob, 3)));

    expect(runNow(unknownSenders.removeSender(alice))).toBe(2);

    expect(runNow(unknownSenders.all).map((row) => row.content)).toEqual([
      "hi 3",
    ]);
    expect(runNow(unknownSenders.insertIfAbsent(incoming(alice, 1)))).toBe(
      false,
    );
  });
});
