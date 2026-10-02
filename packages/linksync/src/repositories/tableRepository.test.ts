import { Effect, Logger, LogLevel } from "effect";
import { makeInMemoryShardDb, ShardDbError, type ShardDb } from "../core";
import { createId } from "../model/ids";
import { linkyTableColumns, type LinkyDbSchema } from "../model/schema";
import { createLinkyStore } from "../model/store";
import { runNow } from "../testing/linky";
import { testAppOwner } from "../testing/toy";
import { tableRepository } from "./tableRepository";
import {
  NonEmptyString,
  NonEmptyString100,
  NonEmptyString1000,
  PositiveInt,
} from "@evolu/common";
import { RumorId } from "@linky-fit/linkstr";
import { directConversationIdFor, nostrMessageIdFor } from "../model/ids";

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
          .pipe(Logger.withMinimumLogLevel(LogLevel.None)),
      );
    expect(runNow(contacts.all)).toHaveLength(230);
    expect(runNow(store.activeIndex("contacts"))).toBe(0);
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
      const store = createLinkyStore(
        makeInMemoryShardDb<LinkyDbSchema>(linkyTableColumns),
        testAppOwner(),
      );
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

    it("does not revive a removed row", () => {
      const store = createLinkyStore(
        makeInMemoryShardDb<LinkyDbSchema>(linkyTableColumns),
        testAppOwner(),
      );
      const messages = messagesOf(store);
      runNow(messages.insertIfAbsent(message("hi")));
      runNow(messages.remove(nostrMessageIdFor(rumorId)));
      expect(runNow(messages.insertIfAbsent(message("hi")))).toBe(false);
      expect(runNow(messages.all)).toEqual([]);
    });

    it("leaves a row in an older shard where it is", () => {
      const store = createLinkyStore(
        makeInMemoryShardDb<LinkyDbSchema>(linkyTableColumns),
        testAppOwner(),
      );
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
});
