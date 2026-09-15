import type { AppOwner } from "@evolu/common";
import { createAppOwner, OwnerSecret } from "@evolu/common";
import { Clock, Effect } from "effect";
import {
  appScope,
  createShardStore,
  makeInMemoryShardDb,
  shardScope,
  type ShardPointerColumns,
} from "../core";

/** A schema with no Linky in it, for testing the shard rules alone. */
export type ToySchema = {
  readonly shardPointer: ShardPointerColumns;
  readonly setting: { readonly id: string; readonly value: string };
  readonly note: {
    readonly id: string;
    readonly title: string;
    readonly body: string | null;
  };
  readonly chat: { readonly id: string; readonly text: string };
};

export const toyScopes = {
  meta: appScope(["shardPointer", "setting"]),
  notes: shardScope({
    tables: ["note"],
    rotation: { maxBytes: 1_000, maxMutations: 3, cooldownMs: 1_000 },
    forget: "never",
  }),
  chats: shardScope({
    tables: ["chat"],
    rotation: { maxBytes: 1_000, maxMutations: 2, cooldownMs: 0 },
    forget: { keepNewest: 2 },
  }),
};

export const testAppOwner = (seed = 1): AppOwner =>
  createAppOwner(OwnerSecret.orThrow(new Uint8Array(32).fill(seed)));

export const toyStore = (appOwner = testAppOwner()) => {
  const db = makeInMemoryShardDb<ToySchema>({
    shardPointer: ["id", "scope", "index", "rotatedAtMs"],
    setting: ["id", "value"],
    note: ["id", "title", "body"],
    chat: ["id", "text"],
  });
  const store = createShardStore<ToySchema, typeof toyScopes>({
    db,
    appOwner,
    scopes: toyScopes,
  });
  return { db, store, appOwner };
};

const manualClock = () => {
  let nowMs = 0;
  const clock: Clock.Clock = {
    [Clock.ClockTypeId]: Clock.ClockTypeId,
    currentTimeMillis: Effect.sync(() => nowMs),
    currentTimeNanos: Effect.sync(() => BigInt(nowMs) * 1_000_000n),
    unsafeCurrentTimeMillis: () => nowMs,
    unsafeCurrentTimeNanos: () => BigInt(nowMs) * 1_000_000n,
    sleep: () => Effect.void,
  };
  return {
    clock,
    advance: (millis: number) => {
      nowMs += millis;
    },
  };
};

const testClock = manualClock();

/** Runs under a manual clock that only `tick` advances. */
export const run = <A, E>(effect: Effect.Effect<A, E>): A =>
  Effect.runSync(Effect.withClock(testClock.clock)(effect));

export const tick = (millis: number): void => {
  testClock.advance(millis);
};
