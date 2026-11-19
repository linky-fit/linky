import {
  createIdFromString,
  createStore,
  createUnknownError,
  Millis,
  Name,
  ownerIdToOwnerIdBytes,
  sqliteQueryStringToSqliteQuery,
  type MutationOptions,
  type OwnerId,
  type Row,
} from "@evolu/common";
import {
  evoluSchemaToSqliteSchema,
  type SyncRoute,
  type SyncState,
} from "@evolu/common/local-first";
import { Effect } from "effect";
import { DatabaseSync } from "node:sqlite";
import { testAppOwner } from "../testing/toy";
import {
  createEvoluShardDb,
  type EvoluRuntime,
  type FailedWrite,
} from "./evoluShardDb";
import { LinkyEvoluSchema, linkyIndexes } from "./linkyEvoluSchema";

const name = Name.orThrow("linky-test");

interface Recorded {
  readonly kind: string;
  readonly table: string;
  readonly row: Record<string, unknown>;
  readonly options: MutationOptions;
}

/**
 * A stand-in for the Evolu instance: records every mutation and query, and
 * answers queries with the rows a test seeds. Mutations succeed in a
 * microtask unless the test holds them.
 */
const fakeEvolu = () => {
  const mutations: Recorded[] = [];
  const queries: string[] = [];
  let rows: ReadonlyArray<Row> = [];
  let held: Recorded[] | null = null;
  const fresh: string[] = [];
  let failFresh = false;
  const mutation =
    (kind: string) =>
    (table: string, row: Record<string, unknown>, options: MutationOptions) => {
      // Evolu throws for an undefined column, with the batch's earlier rows queued.
      if (Object.values(row).includes(undefined)) throw new Error("undefined");
      const recorded = { kind, table, row, options };
      mutations.push(recorded);
      if (held === null) queueMicrotask(() => options.onSuccess?.());
      else held.push(recorded);
      return { id: row.id };
    };
  const runtime: EvoluRuntime = {
    name,
    loadQuery: (query, options) => {
      const { sql } = sqliteQueryStringToSqliteQuery(query);
      if (options?.cache !== false) queries.push(sql);
      else if (failFresh) return Promise.reject(new Error("refused"));
      else fresh.push(sql);
      return Promise.resolve(rows);
    },
    subscribeQuery: () => () => () => {},
    upsert: mutation("upsert"),
    update: mutation("update"),
    getMutationSize: () => 1,
    useOwner: () => () => {},
  };
  return {
    runtime,
    mutations,
    queries,
    fresh,
    failFreshLoads: () => {
      failFresh = true;
    },
    seed: (next: ReadonlyArray<Row>) => {
      rows = next;
    },
    hold: () => {
      held = [];
    },
    succeed: () => {
      for (const { options } of held ?? []) options.onSuccess?.();
      held = null;
    },
    fail: () => {
      for (const { options } of held ?? [])
        options.onError?.(createUnknownError("disk full"));
      held = null;
    },
  };
};

const syncStore = () => createStore<SyncState | null>(null);

const complete: SyncRoute = {
  type: "Complete",
  transportId: createIdFromString<"SyncTransport">("transport"),
  completeAt: Millis.orThrow(1),
  lastSentAt: Millis.orThrow(1),
  lastReceivedAt: null,
};

const stateWith = (
  owners: ReadonlyArray<OwnerId>,
  route: SyncRoute = complete,
): SyncState => ({
  transports: [],
  tenants: [
    {
      type: "Active",
      name,
      owners: owners.map((ownerId) => ({
        type: "Writable",
        ownerId,
        routes: [route],
      })),
    },
  ],
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const open = (
  runtime: EvoluRuntime,
  options: {
    readonly syncState?: ReturnType<typeof syncStore>;
    readonly hasEvoluRelay?: boolean;
    readonly onWriteFailed?: (write: FailedWrite) => void;
  } = {},
) =>
  createEvoluShardDb(runtime, {
    syncState: options.syncState ?? syncStore(),
    hasEvoluRelay: options.hasEvoluRelay ?? true,
    ...(options.onWriteFailed ? { onWriteFailed: options.onWriteFailed } : {}),
  });

describe("evolu shard db", () => {
  it("hands Evolu a SqliteBoolean tombstone and the owner with its write key", async () => {
    const fake = fakeEvolu();
    const db = open(fake.runtime);
    const owner = testAppOwner();
    const id = createIdFromString("contact/c1");
    await Effect.runPromise(
      db.mutate([
        {
          kind: "update",
          table: "contact",
          owner,
          row: { id, isDeleted: true },
        },
      ]),
    );
    expect(fake.mutations).toEqual([
      {
        kind: "update",
        table: "contact",
        row: { id, isDeleted: 1 },
        options: expect.objectContaining({ owner }),
      },
    ]);
  });

  it("queues none of a batch when one row does not fit its column type", async () => {
    const fake = fakeEvolu();
    const db = open(fake.runtime);
    const owner = testAppOwner();
    const result = await Effect.runPromise(
      Effect.result(
        db.mutate([
          { kind: "upsert", table: "setting", owner, row: valid("a") },
          {
            kind: "upsert",
            table: "setting",
            owner,
            row: { ...valid("b"), value: "" },
          },
        ]),
      ),
    );
    expect(result._tag).toBe("Failure");
    expect(fake.mutations).toEqual([]);
  });

  it("omits an undefined column, which Evolu would throw for mid-batch", async () => {
    const fake = fakeEvolu();
    const db = open(fake.runtime);
    const owner = testAppOwner();
    const id = createIdFromString("contact/c1");
    await Effect.runPromise(
      db.mutate([
        { kind: "upsert", table: "setting", owner, row: valid("a") },
        {
          kind: "update",
          table: "contact",
          owner,
          row: { id, name: undefined },
        },
      ]),
    );
    expect(fake.mutations.map(({ row }) => row)).toEqual([valid("a"), { id }]);
  });

  it("requires every non-null column of an upserted row", async () => {
    const fake = fakeEvolu();
    const db = open(fake.runtime);
    const result = await Effect.runPromise(
      Effect.result(
        db.mutate([
          {
            kind: "upsert",
            table: "setting",
            owner: testAppOwner(),
            row: { id: valid("a").id },
          },
        ]),
      ),
    );
    expect(result._tag).toBe("Failure");
    expect(fake.mutations).toEqual([]);
  });

  it("resolves a write only once Evolu stored it", async () => {
    const fake = fakeEvolu();
    const db = open(fake.runtime);
    fake.hold();
    let done = false;
    void Effect.runPromise(
      db.mutate([
        {
          kind: "upsert",
          table: "setting",
          owner: testAppOwner(),
          row: valid("a"),
        },
      ]),
    ).then(() => {
      done = true;
    });
    await settle();
    expect(done).toBe(false);
    fake.succeed();
    await settle();
    expect(done).toBe(true);
  });

  it("fails a write Evolu could not store and reports it", async () => {
    const fake = fakeEvolu();
    const failed: FailedWrite[] = [];
    const db = open(fake.runtime, {
      onWriteFailed: (write) => failed.push(write),
    });
    fake.hold();
    const write = Effect.runPromise(
      Effect.result(
        db.mutate([
          {
            kind: "upsert",
            table: "setting",
            owner: testAppOwner(),
            row: valid("a"),
          },
        ]),
      ),
    );
    await settle();
    fake.fail();
    expect((await write)._tag).toBe("Failure");
    expect(failed).toEqual([
      { tables: ["setting"], rows: 1, error: expect.stringContaining("") },
    ]);
  });

  it("reads back a tombstone an Evolu 7 update created, which has no createdAt", async () => {
    const fake = fakeEvolu();
    const db = open(fake.runtime);
    const ownerId = testAppOwner().id;
    const at = "2026-01-01T00:00:00.000Z";
    fake.seed([
      { id: "c1", ownerId, createdAt: null, updatedAt: at, isDeleted: 1 },
    ]);
    expect(await Effect.runPromise(db.readTable("contact"))).toEqual([
      { id: "c1", ownerId, createdAt: at, updatedAt: at, isDeleted: 1 },
    ]);
  });

  it("asks evolu_history for the owner id's bytes", async () => {
    const fake = fakeEvolu();
    const db = open(fake.runtime);
    const ownerId = testAppOwner().id;
    expect(ownerIdToOwnerIdBytes(ownerId)).toHaveLength(16);
    await Effect.runPromise(db.ownerUsage(ownerId));
    expect(fake.queries).toEqual([
      expect.stringContaining(`from "evolu_history"`),
    ]);
  });

  it("counts an owner synced once a route completed", async () => {
    const fake = fakeEvolu();
    const syncState = syncStore();
    const db = open(fake.runtime, { syncState });
    const owner = testAppOwner();
    const heard: string[] = [];
    db.subscribeOwnerSync(() => heard.push("synced"));

    syncState.set(stateWith([owner.id], { ...complete, type: "Complete" }));
    expect(db.isOwnerSynced(owner.id)).toBe(false);
    await settle();
    expect(db.isOwnerSynced(owner.id)).toBe(true);
    expect(heard).toEqual(["synced"]);
  });

  it("loads the tables read so far afresh before it counts an owner synced", async () => {
    const fake = fakeEvolu();
    const syncState = syncStore();
    const db = open(fake.runtime, { syncState });
    const owner = testAppOwner();
    await Effect.runPromise(db.readTable("shardPointer"));

    syncState.set(stateWith([owner.id]));
    await settle();
    expect(fake.fresh).toEqual(fake.queries);
    expect(db.isOwnerSynced(owner.id)).toBe(true);
  });

  it("keeps an owner unsynced while the fresh load fails", async () => {
    const fake = fakeEvolu();
    const syncState = syncStore();
    const db = open(fake.runtime, { syncState });
    const owner = testAppOwner();
    await Effect.runPromise(db.readTable("shardPointer"));
    fake.failFreshLoads();

    syncState.set(stateWith([owner.id]));
    await settle();
    expect(db.isOwnerSynced(owner.id)).toBe(false);
  });

  it("takes owners whose route completed before the db was created", async () => {
    const fake = fakeEvolu();
    const syncState = syncStore();
    const owner = testAppOwner();
    syncState.set(stateWith([owner.id]));
    const db = open(fake.runtime, { syncState });
    await settle();
    expect(db.isOwnerSynced(owner.id)).toBe(true);
  });

  it("does not count an owner whose route never completed", async () => {
    const fake = fakeEvolu();
    const syncState = syncStore();
    const owner = testAppOwner();
    syncState.set(
      stateWith([owner.id], {
        type: "Pending",
        transportId: complete.transportId,
        failure: null,
        skippedError: null,
        completeAt: null,
        lastSentAt: null,
        lastReceivedAt: null,
      }),
    );
    const db = open(fake.runtime, { syncState });
    await settle();
    expect(db.isOwnerSynced(owner.id)).toBe(false);
  });

  it("counts every owner synced and subscribes none without a relay", () => {
    const fake = fakeEvolu();
    const used: string[] = [];
    const db = open(
      { ...fake.runtime, useOwner: (owner) => (used.push(owner.id), () => {}) },
      { hasEvoluRelay: false },
    );
    const owner = testAppOwner();
    db.useOwner(owner);
    expect(db.isOwnerSynced(owner.id)).toBe(true);
    expect(used).toEqual([]);
  });
});

const valid = (key: string) => ({
  id: createIdFromString(`setting/${key}`),
  key,
  value: "v",
});

/**
 * Evolu's own query compiler over a real SQLite table, so the SQL the
 * adapter builds is what decides which rows come back.
 */
const sqliteEvolu = () => {
  const sqlite = new DatabaseSync(":memory:");
  const loaded: Array<ReadonlyArray<Record<string, unknown>>> = [];
  sqlite.exec(
    `create table cashuProof (id text, ownerId text, createdAt text, updatedAt text,
      isDeleted integer, state text, operationId text, keysetId text, mint text,
      primary key (ownerId, id)) without rowid`,
  );
  for (const index of evoluSchemaToSqliteSchema(LinkyEvoluSchema, linkyIndexes)
    .indexes)
    if (index.sql.includes(`on "cashuProof"`)) sqlite.exec(index.sql);
  const plans: string[] = [];
  const runtime: EvoluRuntime = {
    ...fakeEvolu().runtime,
    loadQuery: (query) => {
      const { sql, parameters } = sqliteQueryStringToSqliteQuery(query);
      const bound = parameters.filter(
        (value) => typeof value === "string" || typeof value === "number",
      );
      for (const step of sqlite
        .prepare(`explain query plan ${sql}`)
        .all(...bound))
        plans.push(String(step.detail));
      const rows = sqlite.prepare(sql).all(...bound);
      loaded.push(rows);
      return Promise.resolve(
        rows.map((row) => ({
          id: String(row.id),
          ownerId: String(row.ownerId),
          createdAt: String(row.createdAt),
          updatedAt: String(row.updatedAt),
          isDeleted: row.isDeleted === null ? null : Number(row.isDeleted),
          state: row.state === null ? null : String(row.state),
          operationId:
            row.operationId === null ? null : String(row.operationId),
          keysetId: row.keysetId === null ? null : String(row.keysetId),
          mint: row.mint === null ? null : String(row.mint),
        })),
      );
    },
  };
  const insert = (row: {
    readonly id: string;
    readonly ownerId: OwnerId;
    readonly createdAt: string;
    readonly isDeleted?: 1;
    readonly state?: string;
    readonly operationId?: string;
    readonly keysetId?: string;
    readonly mint?: string;
  }) =>
    sqlite
      .prepare(
        `insert into cashuProof (id, ownerId, createdAt, updatedAt, isDeleted, state, operationId, keysetId, mint)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.ownerId,
        row.createdAt,
        row.createdAt,
        row.isDeleted ?? null,
        row.state ?? null,
        row.operationId ?? null,
        row.keysetId ?? null,
        row.mint ?? null,
      );
  return { db: open(runtime), insert, loaded, plans };
};

describe("evolu shard db filtered reads over SQLite", () => {
  const older = testAppOwner(1).id;
  const newer = testAppOwner(2).id;
  const unrelated = testAppOwner(3).id;
  const at = "2026-01-01T00:00:00.000Z";
  const unspent = ["available", "held", "handedOut", "externalized"];
  const keysOf = (rows: ReadonlyArray<{ id: string; ownerId: OwnerId }>) =>
    rows.map((row) => `${row.id}@${row.ownerId === older ? 0 : 1}`).sort();

  it("returns every copy of the ids with a live matching copy, tombstones and spent marks included", async () => {
    const { db, insert, loaded } = sqliteEvolu();
    // Copied forward, then spent: only a tombstone matches.
    insert({
      id: "gone",
      ownerId: older,
      createdAt: at,
      isDeleted: 1,
      state: "available",
    });
    insert({ id: "gone", ownerId: newer, createdAt: at, state: "spent" });
    // Spent on another device in a shard this one already copied it out of.
    insert({
      id: "raced",
      ownerId: older,
      createdAt: at,
      isDeleted: 1,
      state: "spent",
    });
    insert({ id: "raced", ownerId: newer, createdAt: at, state: "held" });
    // Spent in an older shard while a device unaware of it wrote it anew.
    insert({ id: "stale", ownerId: older, createdAt: at, state: "spent" });
    insert({ id: "stale", ownerId: newer, createdAt: at, state: "available" });
    insert({ id: "live", ownerId: older, createdAt: at, state: "available" });
    insert({
      id: "removed",
      ownerId: older,
      createdAt: at,
      isDeleted: 1,
      state: "available",
    });

    const rows = await Effect.runPromise(
      db.readCopiesWhere("cashuProof", "state", unspent),
    );

    expect(keysOf(rows)).toEqual([
      "live@0",
      "raced@0",
      "raced@1",
      "stale@0",
      "stale@1",
    ]);
    // The query itself narrows; nothing beyond these copies leaves SQLite.
    expect(loaded.map((result) => result.length)).toEqual([5]);
  });

  it("matches on tombstoned copies too when asked", async () => {
    const { db, insert } = sqliteEvolu();
    // Spent under the send by another device after this one copied it forward.
    insert({
      id: "raced",
      ownerId: older,
      createdAt: at,
      isDeleted: 1,
      state: "spent",
      operationId: "send",
    });
    insert({ id: "raced", ownerId: newer, createdAt: at, state: "available" });
    insert({ id: "other", ownerId: older, createdAt: at, operationId: "else" });

    const live = await Effect.runPromise(
      db.readCopiesWhere("cashuProof", "operationId", ["send"]),
    );
    const any = await Effect.runPromise(
      db.readCopiesWhere("cashuProof", "operationId", ["send"], {
        matchTombstones: true,
      }),
    );

    expect(live).toEqual([]);
    expect(keysOf(any)).toEqual(["raced@0", "raced@1"]);
  });

  it("reads the earliest created copy per value among the given owners", async () => {
    const { db, insert } = sqliteEvolu();
    insert({
      id: "a",
      ownerId: unrelated,
      createdAt: "2026-01-01T00:00:00.000Z",
      keysetId: "00aa",
      mint: "unrelated",
    });
    insert({
      id: "b",
      ownerId: older,
      createdAt: "2026-01-02T00:00:00.000Z",
      isDeleted: 1,
      keysetId: "00aa",
      mint: "first",
    });
    insert({
      id: "c",
      ownerId: newer,
      createdAt: "2026-01-03T00:00:00.000Z",
      keysetId: "00aa",
      mint: "second",
    });
    insert({
      id: "d",
      ownerId: newer,
      createdAt: "2026-01-01T00:00:00.000Z",
      keysetId: "00cc",
      mint: "unasked",
    });

    const rows = await Effect.runPromise(
      db.readOldest(
        "cashuProof",
        "keysetId",
        ["00aa", "00bb"],
        [older, newer],
        "mint",
      ),
    );

    expect(rows.map((row) => row.mint)).toEqual(["first"]);
  });

  it("breaks a tie on the creation time by the lowest tie-break column", async () => {
    const { db, insert } = sqliteEvolu();
    for (const [id, mint] of [
      ["b", "https://b.example"],
      ["a", "https://a.example"],
      ["c", "https://c.example"],
    ] as const)
      insert({ id, ownerId: older, createdAt: at, keysetId: "00aa", mint });

    const rows = await Effect.runPromise(
      db.readOldest("cashuProof", "keysetId", ["00aa"], [older], "mint"),
    );

    expect(rows.map((row) => row.mint)).toEqual(["https://a.example"]);
  });

  it("finds the oldest proof of a keyset through its index, without sorting the history", async () => {
    const { db, insert, plans } = sqliteEvolu();
    insert({
      id: "a",
      ownerId: older,
      createdAt: at,
      keysetId: "00aa",
      mint: "m",
    });

    await Effect.runPromise(
      db.readOldest("cashuProof", "keysetId", ["00aa"], [older, newer], "mint"),
    );

    expect(plans).toEqual([
      expect.stringContaining("USING INDEX cashuProofKeysetCreatedSecond"),
    ]);
  });

  it("ties rows created within the same second", async () => {
    const { db, insert } = sqliteEvolu();
    for (const [id, mint, createdAt] of [
      ["z", "https://z.example", "2026-01-01T00:00:00.100Z"],
      ["a", "https://a.example", "2026-01-01T00:00:00.900Z"],
    ] as const)
      insert({ id, ownerId: older, createdAt, keysetId: "00aa", mint });

    const rows = await Effect.runPromise(
      db.readOldest("cashuProof", "keysetId", ["00aa"], [older], "mint"),
    );

    expect(rows.map((row) => row.mint)).toEqual(["https://a.example"]);
  });
});
