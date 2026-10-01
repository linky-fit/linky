import { Effect, References } from "effect";
import {
  makeInMemoryShardDb,
  ShardDbError,
  type Mutation,
  type ShardDb,
} from "../core";
import { createId } from "@linky-fit/domain";
import { linkyTableColumns, type LinkyDbSchema } from "../model/schema";
import { createLinkyStore } from "../model/store";
import { linkyStore, runNow } from "../testing/linky";
import { testAppOwner } from "../testing/toy";
import { tableRepository } from "./tableRepository";
import {
  NonEmptyString,
  NonEmptyString100,
  NonEmptyString1000,
  PositiveInt,
} from "@evolu/common";
import { Pubkey, RumorId } from "@linky-fit/linkstr";
import {
  directConversationIdFor,
  nostrMessageIdFor,
  nostrReactionIdFor,
} from "../model/ids";

describe("tableRepository", () => {
  it("keeps a write that succeeded when the rotation's pointer write fails", () => {
    const db = makeInMemoryShardDb<LinkyDbSchema>(linkyTableColumns);
    const noPointers: ShardDb<LinkyDbSchema> = {
      ...db,
      mutate: (mutations) =>
        mutations.some((m) => m.table === "shardPointer")
          ? Effect.fail(
              new ShardDbError({ table: "shardPointer", message: "rejected" }),
            )
          : db.mutate(mutations),
    };
    const store = createLinkyStore(noPointers, testAppOwner());
    const contacts = tableRepository(store, "contacts", "contact");
    for (let i = 0; i < 230; i += 1)
      runNow(
        contacts
          .insert({
            id: createId<"Contact">(),
            name: NonEmptyString1000.orThrow(`c${i}`),
          })
          .pipe(Effect.provideService(References.MinimumLogLevel, "None")),
      );
    expect(runNow(contacts.all)).toHaveLength(230);
    expect(runNow(store.activeIndex("contacts"))).toBe(0);
  });

  it("revives a removed row on insert", () => {
    const { store } = linkyStore();
    const contacts = tableRepository(store, "contacts", "contact");
    const contact = {
      id: createId<"Contact">(),
      name: NonEmptyString1000.orThrow("Alice"),
    };
    runNow(contacts.insert(contact));
    runNow(contacts.remove(contact.id));
    runNow(contacts.insert(contact));
    expect(runNow(contacts.byId(contact.id))).toMatchObject(contact);
  });

  describe("insertIfAbsent", () => {
    const rumorId = RumorId.make("ab".repeat(32));
    const message = (content: string) => ({
      id: nostrMessageIdFor(rumorId),
      conversationId: directConversationIdFor(createId<"Contact">()),
      direction: NonEmptyString100.orThrow("in"),
      content: NonEmptyString.orThrow(content),
      wrapId: NonEmptyString1000.orThrow(rumorId),
      createdAtSec: PositiveInt.orThrow(1),
    });
    const messagesOf = (store: ReturnType<typeof createLinkyStore>) =>
      tableRepository(store, "messages", "message");

    it("writes a new row once and keeps what changed it since", () => {
      const { store } = linkyStore();
      const messages = messagesOf(store);
      expect(runNow(messages.insertIfAbsent(message("hi")))).toBe(true);
      runNow(
        messages.update(nostrMessageIdFor(rumorId), {
          content: NonEmptyString.orThrow("hi, edited"),
        }),
      );
      expect(runNow(messages.insertIfAbsent(message("hi")))).toBe(false);
      expect(runNow(messages.all).map((row) => row.content)).toEqual([
        "hi, edited",
      ]);
    });

    it("writes columns only, so a removal synced later still wins", () => {
      const db = makeInMemoryShardDb<LinkyDbSchema>(linkyTableColumns);
      const sent: Mutation[] = [];
      const store = createLinkyStore(
        {
          ...db,
          mutate: (mutations) => {
            sent.push(...mutations);
            return db.mutate(mutations);
          },
        },
        testAppOwner(),
      );
      runNow(messagesOf(store).insertIfAbsent(message("hi")));
      const written = sent.filter((m) => m.table === "message");
      expect(written).toHaveLength(1);
      expect(written[0]?.row).not.toHaveProperty("isDeleted");
    });

    it("does not revive a removed row", () => {
      const { store } = linkyStore();
      const messages = messagesOf(store);
      runNow(messages.insertIfAbsent(message("hi")));
      runNow(messages.remove(nostrMessageIdFor(rumorId)));
      expect(runNow(messages.insertIfAbsent(message("hi")))).toBe(false);
      expect(runNow(messages.all)).toEqual([]);
    });

    it("leaves a row in an older shard where it is", () => {
      const { store } = linkyStore();
      const messages = messagesOf(store);
      runNow(messages.insertIfAbsent(message("hi")));
      runNow(store.rotate("messages"));
      expect(runNow(messages.insertIfAbsent(message("hi")))).toBe(false);
      const copies = runNow(store.copies("messages", "message"));
      expect(copies.map((row) => row.ownerId)).toEqual([
        store.shardOwner("messages", 0).id,
      ]);
    });
  });

  describe("removeIfAbsent", () => {
    const rumorId = RumorId.make("cd".repeat(32));
    const reactor = Pubkey.make("ef".repeat(32));
    const id = nostrReactionIdFor(rumorId, reactor);
    const reactionsOf = (store: ReturnType<typeof createLinkyStore>) =>
      tableRepository(store, "messages", "reaction");
    const reaction = {
      id,
      conversationId: directConversationIdFor(createId<"Contact">()),
      messageId: NonEmptyString1000.orThrow("ab".repeat(32)),
      reactorPubkey: NonEmptyString1000.orThrow(reactor),
      emoji: NonEmptyString100.orThrow("👍"),
      createdAtSec: PositiveInt.orThrow(1),
      wrapId: NonEmptyString1000.orThrow(rumorId),
    };

    it("stores a removal that refuses the row arriving later", () => {
      const { store } = linkyStore();
      const reactions = reactionsOf(store);
      expect(
        runNow(
          reactions.removeIfAbsent({
            id,
            reactorPubkey: reaction.reactorPubkey,
            wrapId: reaction.wrapId,
          }),
        ),
      ).toBe(true);
      expect(runNow(reactions.insertIfAbsent(reaction))).toBe(false);
      expect(runNow(reactions.all)).toEqual([]);
      expect(runNow(store.copies("messages", "reaction"))).toEqual([
        expect.objectContaining({ id, isDeleted: 1, messageId: null }),
      ]);
    });

    it("leaves a stored row alone", () => {
      const { store } = linkyStore();
      const reactions = reactionsOf(store);
      runNow(reactions.insertIfAbsent(reaction));
      expect(runNow(reactions.removeIfAbsent({ id }))).toBe(false);
      expect(runNow(reactions.all)).toHaveLength(1);
    });
  });
});
