import { Effect } from "effect";
import { makeInMemoryShardDb } from "../core";
import { linkyTableColumns, type LinkyDbSchema } from "../model/schema";
import { createLinkyStore } from "../model/store";
import { testAppOwner } from "./toy";

/** A Linky store over the in-memory port, one per test. */
export const linkyStore = (appOwner = testAppOwner()) => {
  const db = makeInMemoryShardDb<LinkyDbSchema>(linkyTableColumns);
  const store = createLinkyStore(db, appOwner);
  return { db, store, appOwner };
};

export const runNow = <A, E>(effect: Effect.Effect<A, E>): A =>
  Effect.runSync(effect);
