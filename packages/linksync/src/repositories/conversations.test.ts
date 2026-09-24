import {
  NonEmptyString,
  NonEmptyString100,
  NonEmptyString1000,
  PositiveInt,
} from "@evolu/common";
import { createId, directConversationIdFor } from "@linky/domain";
import { linkyStore, runNow } from "../testing/linky";
import { makeConversationsRepository } from "./conversations";

const sec = (value: number) => PositiveInt.orThrow(value);

describe("conversations repository", () => {
  it("creates the direct conversation of a contact once, with a derived id", () => {
    const { store } = linkyStore();
    const conversations = makeConversationsRepository(store);
    const contactId = createId<"Contact">();
    const first = runNow(conversations.ensureDirect(contactId));
    const second = runNow(conversations.ensureDirect(contactId));
    expect(first.id).toBe(directConversationIdFor(contactId));
    expect(second.id).toBe(first.id);
    expect(runNow(conversations.all)).toHaveLength(1);
    expect(runNow(conversations.forContact(contactId))?.kind).toBe("direct");
  });

  it("moves the read cursor forward only", () => {
    const { store } = linkyStore();
    const conversations = makeConversationsRepository(store);
    const { id } = runNow(conversations.ensureDirect(createId<"Contact">()));
    runNow(conversations.markSeen(id, sec(200)));
    runNow(conversations.markSeen(id, sec(100)));
    expect(runNow(conversations.byId(id))?.lastSeenAtSec).toBe(200);
  });

  it("records the peer's seen window and the archive state", () => {
    const { store } = linkyStore();
    const conversations = makeConversationsRepository(store);
    const { id } = runNow(conversations.ensureDirect(createId<"Contact">()));
    runNow(
      conversations.setPeerSeen(id, { sinceSec: sec(10), atSec: sec(20) }),
    );
    runNow(conversations.archive(id, sec(30)));
    expect(runNow(conversations.byId(id))).toMatchObject({
      peerSeenSinceSec: 10,
      peerSeenAtSec: 20,
      archivedAtSec: 30,
    });
    runNow(conversations.unarchive(id));
    expect(runNow(conversations.byId(id))?.archivedAtSec).toBeNull();
  });

  it("lists the messages and reactions of one conversation", () => {
    const { store } = linkyStore();
    const conversations = makeConversationsRepository(store);
    const a = runNow(conversations.ensureDirect(createId<"Contact">()));
    const b = runNow(conversations.ensureDirect(createId<"Contact">()));
    const message = (conversationId: typeof a.id, content: string) => ({
      id: createId<"Message">(),
      conversationId,
      direction: NonEmptyString100.orThrow("in"),
      content: NonEmptyString.orThrow(content),
      wrapId: NonEmptyString1000.orThrow(`wrap-${content}`),
      createdAtSec: sec(1),
    });
    runNow(conversations.messages.insert(message(a.id, "hi a")));
    runNow(conversations.messages.insert(message(b.id, "hi b")));
    runNow(
      conversations.reactions.insert({
        id: createId<"Reaction">(),
        conversationId: a.id,
        messageId: NonEmptyString1000.orThrow("rumor"),
        reactorPubkey: NonEmptyString1000.orThrow("pk"),
        emoji: NonEmptyString100.orThrow("👍"),
        createdAtSec: sec(2),
        wrapId: NonEmptyString1000.orThrow("wrap-r"),
      }),
    );
    expect(
      runNow(conversations.messagesIn(a.id)).map((m) => m.content),
    ).toEqual(["hi a"]);
    expect(runNow(conversations.reactionsIn(a.id))).toHaveLength(1);
    expect(runNow(conversations.reactionsIn(b.id))).toHaveLength(0);
  });

  it("keeps a removed reaction's tombstone readable", () => {
    const { store } = linkyStore();
    const conversations = makeConversationsRepository(store);
    const chat = runNow(conversations.ensureDirect(createId<"Contact">()));
    const id = createId<"Reaction">();
    runNow(
      conversations.reactions.insert({
        id,
        conversationId: chat.id,
        messageId: NonEmptyString1000.orThrow("rumor"),
        reactorPubkey: NonEmptyString1000.orThrow("pk"),
        emoji: NonEmptyString100.orThrow("👍"),
        createdAtSec: sec(2),
        wrapId: NonEmptyString1000.orThrow("wrap-removed"),
      }),
    );
    runNow(conversations.reactions.remove(id));
    expect(runNow(conversations.reactions.all)).toHaveLength(0);
    expect(runNow(conversations.removedReactions).map((r) => r.wrapId)).toEqual(
      ["wrap-removed"],
    );
  });

  it("takes an old conversation forward when its cursor moves after a rotation", () => {
    const { db, store } = linkyStore();
    const conversations = makeConversationsRepository(store);
    const { id } = runNow(conversations.ensureDirect(createId<"Contact">()));
    runNow(store.rotate("messages"));
    runNow(conversations.markSeen(id, sec(50)));
    const live = runNow(conversations.all);
    expect(live).toHaveLength(1);
    expect(live[0]?.ownerId).toBe(store.shardOwner("messages", 1).id);
    const oldCopy = runNow(db.readTable("conversation")).find(
      (row) => row.ownerId === store.shardOwner("messages", 0).id,
    );
    expect(oldCopy?.isDeleted).toBe(1);
  });
});
