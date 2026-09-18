import { Effect, Logger, LogLevel } from "effect";
import { makeInMemoryShardDb, ShardDbError, type ShardDb } from "../core";
import { createId } from "../model/ids";
import { linkyTableColumns, type LinkyDbSchema } from "../model/schema";
import { createLinkyStore } from "../model/store";
import { runNow } from "../testing/linky";
import { testAppOwner } from "../testing/toy";
import { tableRepository } from "./tableRepository";
import { NonEmptyString1000 } from "@evolu/common";

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
});
