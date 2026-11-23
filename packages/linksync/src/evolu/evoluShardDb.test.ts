import {
  AppName,
  createEvolu,
  createIdFromString,
  createRun,
  createStore,
  createUnknownError,
  createWorker,
  createXChaCha20Poly1305,
  deriveShardOwner,
  err,
  FiniteNumber,
  Millis,
  Name,
  ok,
  ownerIdToOwnerIdBytes,
  PositiveInt,
  sqliteQueryStringToSqliteQuery,
  testCreateBroadcastChannel,
  testCreateDeps,
  testCreateMessageChannel,
  testCreateMessagePort,
  testCreateTime,
  waitForAbort,
  WebSocketUrlFromString,
  type CreateWebSocket,
  type DeleteOwnerError,
  type LockManagerDep,
  type MessagePort,
  type MutationOptions,
  type OwnerId,
  type Result,
  type Row,
  type ShardOwner,
  type SharedWorker,
  type SharedWorkerSelf,
  type SqliteDriver,
  type SqliteQuery,
  type SqliteQueryParameters,
  type SqliteRow,
  type SqliteValue,
} from "@evolu/common";
import {
  Counter,
  createEvoluDeps,
  createInitialTimestamp,
  createProtocolBroadcastMessagesFromCrdtMessages,
  createTimestamp,
  DbChange,
  evoluSchemaToSqliteSchema,
  initSharedWorker,
  startDbWorker,
  type DbWorkerInit,
  type SharedWorkerInput,
  type SharedWorkerOutput,
  type SyncRoute,
  type SyncState,
} from "@evolu/common/local-first";
import { installPolyfills } from "@evolu/common/polyfills";
import { Effect } from "effect";
import {
  DatabaseSync,
  type SQLInputValue,
  type StatementSync,
} from "node:sqlite";

installPolyfills();
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
  const deletedOwners: ShardOwner[] = [];
  let deleteOwnerResult: Result<void, DeleteOwnerError> = ok();
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
    deleteOwner: (owner) => {
      deletedOwners.push(owner);
      return Promise.resolve(deleteOwnerResult);
    },
  };
  return {
    runtime,
    mutations,
    queries,
    fresh,
    deletedOwners,
    failDeleteOwner: (error: DeleteOwnerError) => {
      deleteOwnerResult = err(error);
    },
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
    const owner = testAppOwner();
    const write = Effect.runPromise(
      Effect.result(
        db.mutate([
          {
            kind: "upsert",
            table: "setting",
            owner,
            row: valid("a"),
          },
        ]),
      ),
    );
    await settle();
    fake.fail();
    expect((await write)._tag).toBe("Failure");
    expect(failed).toEqual([
      {
        tables: ["setting"],
        ownerIds: [owner.id],
        rows: 1,
        error: expect.stringContaining(""),
      },
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

  it("does not count an owner synced when a Settled route has null completeAt", async () => {
    const fake = fakeEvolu();
    const syncState = syncStore();
    const db = open(fake.runtime, { syncState });
    const owner = testAppOwner();
    syncState.set(
      stateWith([owner.id], {
        type: "Settled",
        transportId: complete.transportId,
        skippedError: {
          type: "ProtocolChangeTooLargeError",
          timestamp: createInitialTimestamp(testCreateDeps()),
          size: PositiveInt.orThrow(100_000),
          at: Millis.orThrow(1),
        },
        completeAt: null,
        lastSentAt: Millis.orThrow(1),
        lastReceivedAt: Millis.orThrow(1),
      }),
    );
    await settle();
    expect(db.isOwnerSynced(owner.id)).toBe(false);

    syncState.set(
      stateWith([owner.id], {
        type: "Settled",
        transportId: complete.transportId,
        skippedError: {
          type: "DecryptWithXChaCha20Poly1305Error",
          error: createUnknownError("invalid tag"),
          at: Millis.orThrow(1),
        },
        completeAt: null,
        lastSentAt: Millis.orThrow(1),
        lastReceivedAt: Millis.orThrow(1),
      }),
    );
    await settle();
    expect(db.isOwnerSynced(owner.id)).toBe(false);
  });

  it("counts an owner synced when a Settled route already completed cleanly earlier", async () => {
    const fake = fakeEvolu();
    const syncState = syncStore();
    const db = open(fake.runtime, { syncState });
    const owner = testAppOwner();
    syncState.set(
      stateWith([owner.id], {
        type: "Settled",
        transportId: complete.transportId,
        skippedError: {
          type: "ProtocolChangeTooLargeError",
          timestamp: createInitialTimestamp(testCreateDeps()),
          size: PositiveInt.orThrow(100_000),
          at: Millis.orThrow(2),
        },
        completeAt: Millis.orThrow(1),
        lastSentAt: Millis.orThrow(2),
        lastReceivedAt: Millis.orThrow(2),
      }),
    );
    await settle();
    expect(db.isOwnerSynced(owner.id)).toBe(true);
  });

  it("deletes a shard owner through Evolu and turns refusal errors into ShardDbError", async () => {
    const fake = fakeEvolu();
    const db = open(fake.runtime);
    const shard = deriveShardOwner(testAppOwner(), ["messages", 0]);
    await Effect.runPromise(db.deleteOwner(shard));
    expect(fake.deletedOwners).toEqual([shard]);

    fake.failDeleteOwner({ type: "DatabaseHeldError", name });
    const failed = await Effect.runPromise(
      Effect.result(db.deleteOwner(shard)),
    );
    expect(failed._tag).toBe("Failure");
  });

  it("subscribes no owners without a relay", () => {
    const fake = fakeEvolu();
    const used: string[] = [];
    const db = open(
      { ...fake.runtime, useOwner: (owner) => (used.push(owner.id), () => {}) },
      { hasEvoluRelay: false },
    );
    const owner = testAppOwner();
    db.useOwner(owner);
    expect(db.isOwnerSynced(owner.id)).toBe(false);
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

const createInMemoryLockManager = (): LockManagerDep["lockManager"] => {
  const held = new Map<string, Promise<void>>();
  const request: LockManagerDep["lockManager"]["request"] = async <T>(
    lockName: string,
    optionsOrCallback: LockOptions | ((lock: Lock | null) => Promise<T> | T),
    maybeCallback?: (lock: Lock | null) => Promise<T> | T,
  ): Promise<T> => {
    const options =
      typeof optionsOrCallback === "function" ? {} : optionsOrCallback;
    const callback =
      typeof optionsOrCallback === "function"
        ? optionsOrCallback
        : maybeCallback;
    if (!callback) throw new Error("Missing lock callback");
    if (options.ifAvailable && held.has(lockName)) return callback(null);
    while (held.has(lockName)) {
      const waiting = held.get(lockName);
      if (!waiting) break;
      if (options.signal?.aborted)
        throw options.signal.reason ?? new Error("Lock request aborted");
      await new Promise<void>((resolve, reject) => {
        const signal = options.signal;
        const onAbort = () =>
          reject(signal?.reason ?? new Error("Lock request aborted"));
        signal?.addEventListener("abort", onAbort, { once: true });
        void waiting.then(() => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        });
      });
    }
    if (options.signal?.aborted)
      throw options.signal.reason ?? new Error("Lock request aborted");
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    held.set(lockName, promise);
    try {
      return await callback({
        name: lockName,
        mode: options.mode ?? "exclusive",
      });
    } finally {
      held.delete(lockName);
      release();
    }
  };
  return {
    request,
    query: () =>
      Promise.resolve({
        held: [...held.keys()].map((heldName) => ({
          name: heldName,
          mode: "exclusive" as const,
        })),
        pending: [],
      }),
  };
};

const toSqliteInput = (value: SqliteValue): SQLInputValue => value;

const toSqliteRow = (record: Record<string, unknown>): SqliteRow => {
  const row: Record<string, SqliteValue> = {};
  for (const [key, value] of Object.entries(record)) {
    if (
      value === null ||
      typeof value === "string" ||
      value instanceof Uint8Array
    ) {
      row[key] = value;
    } else if (typeof value === "number") {
      row[key] = FiniteNumber.orThrow(value);
    } else if (typeof value === "bigint") {
      row[key] = FiniteNumber.orThrow(Number(value));
    }
  }
  return row;
};

const runStatement = (
  statement: StatementSync,
  parameters: SqliteQueryParameters,
) => {
  const bound = parameters.map(toSqliteInput);
  if (statement.columns().length > 0) {
    return {
      rows: statement.all(...bound).map(toSqliteRow),
      changes: 0,
    };
  }
  const info = statement.run(...bound);
  return { rows: [], changes: Number(info.changes) };
};

/**
 * Minimal in-memory WebSocket relay that accepts injected binary Evolu protocol
 * frames so tests can deliver real encrypted sync messages (including
 * older-timestamp changes) through Evolu's `ApplySyncMessage` pipeline.
 */
const createInMemoryRelay = (): {
  readonly createWebSocket: CreateWebSocket;
  readonly deliver: (frame: Uint8Array) => void;
} => {
  const listeners = new Set<(data: ArrayBuffer) => void>();
  return {
    createWebSocket: (_url, options) => () => {
      const receive = (data: ArrayBuffer) => {
        options?.onMessage?.(data);
      };
      listeners.add(receive);
      queueMicrotask(() => options?.onOpen?.());
      return Promise.resolve(
        ok({
          send: () => ok(),
          getReadyState: () => "open" as const,
          isOpen: () => true,
          reconnect: () => {},
          [Symbol.dispose]: () => {
            listeners.delete(receive);
          },
          [Symbol.asyncDispose]: () => {
            listeners.delete(receive);
            return Promise.resolve();
          },
        }),
      );
    },
    deliver: (frame) => {
      const buffer = new ArrayBuffer(frame.byteLength);
      new Uint8Array(buffer).set(frame);
      for (const listener of listeners) queueMicrotask(() => listener(buffer));
    },
  };
};

interface RealEvoluHarness {
  readonly openInstance: (options: {
    readonly appOwner: ReturnType<typeof testAppOwner>;
    readonly withRelay?: boolean;
  }) => Promise<{
    readonly evolu: Parameters<typeof createEvoluShardDb>[0];
    readonly db: ReturnType<typeof createEvoluShardDb>;
    readonly rawSqlite: () => DatabaseSync;
    readonly dispose: () => Promise<void>;
  }>;
  readonly dispose: () => Promise<void>;
}

/**
 * Runs the real Evolu SharedWorker + DbWorker + `node:sqlite` stack in-process
 * so subscription invalidation, query plans, sync messages, and `deleteOwner`
 * execute against Evolu's actual runtime.
 */
const createRealEvoluHarness = (
  options: {
    readonly nowMs?: number;
    readonly createWebSocket?: CreateWebSocket;
  } = {},
): RealEvoluHarness => {
  const lockManager = createInMemoryLockManager();
  const dbs = new Map<string, DatabaseSync>();
  const runs: Array<AsyncDisposable> = [];
  const createSqliteDriver = (dbName: Name) => () => {
    let sqlite = dbs.get(dbName);
    if (!sqlite) {
      sqlite = new DatabaseSync(":memory:");
      const db = sqlite;
      db.function(
        "evolu_skiplist_insert",
        (ownerId: SQLInputValue, ts: SQLInputValue, level: SQLInputValue) => {
          const result = db
            .prepare(
              `insert or ignore into "evolu_timestamp" ("ownerId", "t", "l") values (?, ?, ?)`,
            )
            .run(ownerId, ts, level);
          return Number(result.changes > 0 ? 1 : 0);
        },
      );
      db.function("evolu_skiplist_size", (ownerId: SQLInputValue) => {
        const row = db
          .prepare(
            `select count(*) as size from "evolu_timestamp" where "ownerId" = ?`,
          )
          .get(ownerId);
        return Number(row?.size ?? 0);
      });
      db.function(
        "evolu_skiplist_timestamp_at",
        (ownerId: SQLInputValue, index: SQLInputValue) => {
          const row = db
            .prepare(
              `select "t" from "evolu_timestamp" where "ownerId" = ? order by "t" limit 1 offset ?`,
            )
            .get(ownerId, index);
          const t = row?.t;
          return t instanceof Uint8Array ? t : null;
        },
      );
      dbs.set(dbName, sqlite);
    }
    const db = sqlite;
    const driver: SqliteDriver = {
      exec: (query: SqliteQuery) =>
        runStatement(db.prepare(query.sql), query.parameters),
      prepare: (sqlText) => {
        const statement = db.prepare(sqlText);
        return {
          exec: (parameters) => runStatement(statement, parameters),
          [Symbol.dispose]: () => {},
        };
      },
      iterate: (query, onRow) => {
        const statement = db.prepare(query.sql);
        for (const row of statement.iterate(
          ...query.parameters.map(toSqliteInput),
        )) {
          if (!onRow(toSqliteRow(row))) break;
        }
      },
      deleteDatabase: () => {
        dbs.delete(dbName);
      },
      export: () => new Uint8Array(),
      [Symbol.dispose]: () => {},
    };
    return Promise.resolve(ok(driver));
  };

  const baseDeps = {
    ...testCreateDeps(),
    ...(options.nowMs === undefined
      ? {}
      : { time: testCreateTime({ startAt: Millis.orThrow(options.nowMs) }) }),
    consoleStoreOutputEntry: createStore(null),
  };
  const relaySocket =
    options.createWebSocket ?? createInMemoryRelay().createWebSocket;
  type SwPort = MessagePort<SharedWorkerOutput, SharedWorkerInput>;
  let swStarted = false;
  let onConnectHandler: ((port: SwPort) => void) | null = null;
  const pendingPorts: SwPort[] = [];
  const swSelf: SharedWorkerSelf<SharedWorkerInput, SharedWorkerOutput> = {
    get onConnect() {
      return onConnectHandler;
    },
    set onConnect(fn) {
      onConnectHandler = fn;
      if (fn) for (const port of pendingPorts.splice(0)) fn(port);
    },
    [Symbol.dispose]: () => {
      onConnectHandler = null;
      pendingPorts.length = 0;
    },
  };
  const connectSharedWorker = (): SharedWorker<
    SharedWorkerInput,
    SharedWorkerOutput
  > => {
    if (!swStarted) {
      swStarted = true;
      const swRun = createRun({
        ...baseDeps,
        createMessageChannel: testCreateMessageChannel,
        createMessagePort: testCreateMessagePort,
        createBroadcastChannel: testCreateBroadcastChannel,
        createWebSocket: relaySocket,
        lockManager,
      });
      runs.push(swRun);
      void swRun(async (r) => {
        await r.ok(initSharedWorker(swSelf));
        return r(waitForAbort);
      });
    }
    const channel = testCreateMessageChannel<
      SharedWorkerInput,
      SharedWorkerOutput
    >();
    if (onConnectHandler) onConnectHandler(channel.port2);
    else pendingPorts.push(channel.port2);
    return {
      port: channel.port1,
      [Symbol.dispose]: () => {
        channel[Symbol.dispose]();
      },
    };
  };

  const createDbWorker = () =>
    createWorker<DbWorkerInit>((self) => {
      const dbRun = createRun({
        ...baseDeps,
        createSqliteDriver,
        deleteDatabaseFiles: () => () => Promise.resolve(ok()),
        createMessagePort: testCreateMessagePort,
        createBroadcastChannel: testCreateBroadcastChannel,
        lockManager,
      });
      runs.push(dbRun);
      void dbRun(startDbWorker(self));
    });

  return {
    openInstance: async ({ appOwner, withRelay = false }) => {
      const deps = createEvoluDeps({
        ...baseDeps,
        createDbWorker,
        createStoredWorker: connectSharedWorker,
        createBroadcastChannel: testCreateBroadcastChannel,
        createMessageChannel: testCreateMessageChannel,
        getDevicePersistence: () => Promise.resolve("Persisted"),
        lockManager,
        reloadApp: () => {},
      });
      const instanceRun = createRun({ ...baseDeps, ...deps });
      runs.push(instanceRun);
      const transports = withRelay
        ? [
            {
              type: "WebSocket" as const,
              url: WebSocketUrlFromString.orThrow("wss://relay.example"),
            },
          ]
        : [];
      const evolu = await instanceRun.ok(
        createEvolu(LinkyEvoluSchema, {
          appName: AppName.orThrow("linky"),
          appOwner,
          indexes: linkyIndexes,
          transports,
        }),
      );
      const db = createEvoluShardDb(evolu, {
        syncState: deps.syncState,
        hasEvoluRelay: withRelay,
      });
      await Effect.runPromise(db.readTable("shardPointer"));
      return {
        evolu,
        db,
        rawSqlite: () => {
          const sqlite = dbs.get(evolu.name);
          if (!sqlite) throw new Error(`Missing sqlite db ${evolu.name}`);
          return sqlite;
        },
        dispose: async () => {
          await evolu[Symbol.asyncDispose]();
          deps[Symbol.dispose]();
        },
      };
    },
    dispose: async () => {
      await Promise.all(runs.map((r) => r[Symbol.asyncDispose]()));
      for (const db of dbs.values()) db.close();
      dbs.clear();
    },
  };
};

const waitFor = async (
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline)
      throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

describe("evolu shard db subscriptions over real Evolu SQLite", () => {
  it("uses historyTable and table id indexes for the table-change digest", async () => {
    const harness = createRealEvoluHarness();
    try {
      const appOwner = testAppOwner(11);
      const instance = await harness.openInstance({ appOwner });
      const subscribedSql: Array<{
        readonly sql: string;
        readonly parameters: SqliteQueryParameters;
      }> = [];
      const inspectingDb = createEvoluShardDb(
        {
          ...instance.evolu,
          subscribeQuery: (query) => {
            const parsed = sqliteQueryStringToSqliteQuery(query);
            subscribedSql.push({
              sql: parsed.sql,
              parameters: parsed.parameters,
            });
            return instance.evolu.subscribeQuery(query);
          },
        },
        { syncState: syncStore(), hasEvoluRelay: false },
      );

      const stop = inspectingDb.subscribe("message", () => {});
      stop();

      expect(subscribedSql).toHaveLength(1);
      const [{ sql, parameters }] = subscribedSql;
      expect(sql).not.toContain(`select * from "message"`);
      const plan = instance
        .rawSqlite()
        .prepare(`explain query plan ${sql}`)
        .all(...parameters.map(toSqliteInput))
        .map((step) => String(step.detail));
      expect(plan).toContainEqual(
        expect.stringContaining("USING INDEX historyTable"),
      );
      expect(plan).toContainEqual(
        expect.stringContaining("USING COVERING INDEX evolu_message_id"),
      );
      await instance.dispose();
    } finally {
      await harness.dispose();
    }
  });

  it("notifies on insert, update, copy-forward, soft delete, and revive without firing unrelated tables or serving stale reads", async () => {
    const harness = createRealEvoluHarness();
    try {
      const appOwner = testAppOwner(12);
      const shard0 = deriveShardOwner(appOwner, ["contacts", 0]);
      const shard1 = deriveShardOwner(appOwner, ["contacts", 1]);
      const instance = await harness.openInstance({ appOwner });

      let contactEvents = 0;
      let messageEvents = 0;
      const stopContact = instance.db.subscribe("contact", () => {
        contactEvents += 1;
      });
      const stopMessage = instance.db.subscribe("message", () => {
        messageEvents += 1;
      });
      await waitFor(() => contactEvents >= 1 && messageEvents >= 1);
      contactEvents = 0;
      messageEvents = 0;

      const id = createIdFromString("contact/alice");
      // Local insert
      await Effect.runPromise(
        instance.db.mutate([
          {
            kind: "upsert",
            table: "contact",
            owner: shard0,
            row: { id, name: "Alice" },
          },
        ]),
      );
      expect(contactEvents).toBe(1);
      expect(messageEvents).toBe(0);
      expect(
        (await Effect.runPromise(instance.db.readTable("contact"))).map(
          (row) => [row.ownerId, row.name, row.isDeleted],
        ),
      ).toEqual([[shard0.id, "Alice", null]]);

      // Local in-place update
      await Effect.runPromise(
        instance.db.mutate([
          {
            kind: "update",
            table: "contact",
            owner: shard0,
            row: { id, name: "Alice 2" },
          },
        ]),
      );
      expect(contactEvents).toBe(2);
      expect(messageEvents).toBe(0);
      expect(
        (await Effect.runPromise(instance.db.readTable("contact"))).map(
          (row) => row.name,
        ),
      ).toEqual(["Alice 2"]);

      // Copy-forward into shard 1 + tombstone in shard 0
      await Effect.runPromise(
        instance.db.mutate([
          {
            kind: "upsert",
            table: "contact",
            owner: shard1,
            row: { id, name: "Alice 3" },
          },
          {
            kind: "update",
            table: "contact",
            owner: shard0,
            row: { id, isDeleted: true },
          },
        ]),
      );
      expect(contactEvents).toBe(3);
      expect(messageEvents).toBe(0);
      expect(
        await Effect.runPromise(instance.db.readTable("contact")),
      ).toHaveLength(2);

      // Soft delete on shard 1
      await Effect.runPromise(
        instance.db.mutate([
          {
            kind: "update",
            table: "contact",
            owner: shard1,
            row: { id, isDeleted: true },
          },
        ]),
      );
      expect(contactEvents).toBe(4);
      expect(
        (await Effect.runPromise(instance.db.readTable("contact"))).find(
          (row) => row.ownerId === shard1.id,
        )?.isDeleted,
      ).toBe(1);

      // Revive on shard 1
      await Effect.runPromise(
        instance.db.mutate([
          {
            kind: "upsert",
            table: "contact",
            owner: shard1,
            row: { id, name: "Alice revived", isDeleted: false },
          },
        ]),
      );
      expect(contactEvents).toBe(5);
      expect(messageEvents).toBe(0);
      const revived = (
        await Effect.runPromise(instance.db.readTable("contact"))
      ).find((row) => row.ownerId === shard1.id);
      expect(revived?.isDeleted).toBe(0);
      expect(revived?.name).toBe("Alice revived");

      stopContact();
      stopMessage();
      await instance.dispose();
    } finally {
      await harness.dispose();
    }
  });

  it("notifies and refreshes reads when a synced change arrives with an older timestamp", async () => {
    const relay = createInMemoryRelay();
    const baseTime = 1_700_000_050_000;
    const harness = createRealEvoluHarness({
      nowMs: baseTime,
      createWebSocket: relay.createWebSocket,
    });
    try {
      const appOwner = testAppOwner(21);
      const sharedShard = deriveShardOwner(appOwner, ["contacts", 0]);
      const device = await harness.openInstance({
        appOwner,
        withRelay: true,
      });
      const unuse = device.db.useOwner(sharedShard);

      const newerId = createIdFromString("contact/newer");
      const olderId = createIdFromString("contact/older");
      await Effect.runPromise(
        device.db.mutate([
          {
            kind: "upsert",
            table: "contact",
            owner: sharedShard,
            row: { id: newerId, name: "Newer" },
          },
        ]),
      );
      const [newerRow] = await Effect.runPromise(
        device.db.readTable("contact"),
      );
      expect(newerRow?.name).toBe("Newer");

      let contactEvents = 0;
      const stop = device.db.subscribe("contact", () => {
        contactEvents += 1;
      });
      await waitFor(() => contactEvents >= 1);
      contactEvents = 0;

      const protocolDeps = {
        ...testCreateDeps(),
        xChaCha20Poly1305: createXChaCha20Poly1305(),
      };
      // 1) Synced insert with a timestamp 30 seconds older than `newerRow`.
      const olderInsertFrames = createProtocolBroadcastMessagesFromCrdtMessages(
        protocolDeps,
      )(sharedShard, [
        {
          timestamp: createTimestamp({
            millis: Millis.orThrow(baseTime - 30_000),
            counter: Counter.orThrow(0),
          }),
          change: DbChange.orThrow({
            table: "contact",
            id: olderId,
            values: { name: "Older from sync" },
            isInsert: true,
            isDelete: false,
          }),
        },
      ]);
      for (const frame of olderInsertFrames) relay.deliver(frame);

      await waitFor(() => contactEvents >= 1);
      const afterInsert = await Effect.runPromise(
        device.db.readTable("contact"),
      );
      const syncedOlder = afterInsert.find((row) => row.id === olderId);
      expect(syncedOlder?.name).toBe("Older from sync");
      expect(syncedOlder !== undefined && newerRow !== undefined).toBe(true);
      if (syncedOlder && newerRow) {
        expect(syncedOlder.createdAt < newerRow.createdAt).toBe(true);
      }

      // 2) Give `newerId` a non-null `updatedAt`, then deliver a synced update
      // to `olderId` at a timestamp between `olderId.createdAt` and `newerRow`:
      // row count, max(createdAt), and max(updatedAt) all stay fixed, yet the
      // digest still fires.
      await Effect.runPromise(
        device.db.mutate([
          {
            kind: "update",
            table: "contact",
            owner: sharedShard,
            row: { id: newerId, name: "Newer edited" },
          },
        ]),
      );
      await waitFor(() => contactEvents >= 2);
      const readRawBounds = () =>
        device
          .rawSqlite()
          .prepare(
            `select count(*) as count, max("createdAt") as maxCreated, max("updatedAt") as maxUpdated from "contact"`,
          )
          .get();
      const boundsBefore = readRawBounds();
      expect(boundsBefore?.maxUpdated).not.toBeNull();

      contactEvents = 0;
      const olderUpdateFrames = createProtocolBroadcastMessagesFromCrdtMessages(
        protocolDeps,
      )(sharedShard, [
        {
          timestamp: createTimestamp({
            millis: Millis.orThrow(baseTime - 20_000),
            counter: Counter.orThrow(0),
          }),
          change: DbChange.orThrow({
            table: "contact",
            id: olderId,
            values: { lnAddress: "older@example.com" },
            isInsert: false,
            isDelete: null,
          }),
        },
      ]);
      for (const frame of olderUpdateFrames) relay.deliver(frame);

      await waitFor(() => contactEvents >= 1);
      expect(readRawBounds()).toEqual(boundsBefore);
      const afterUpdate = await Effect.runPromise(
        device.db.readTable("contact"),
      );
      expect(afterUpdate.find((row) => row.id === olderId)?.lnAddress).toBe(
        "older@example.com",
      );

      stop();
      unuse();
      await device.dispose();
    } finally {
      await harness.dispose();
    }
  });

  it("notifies and drops cached rows on deleteOwner of an older shard and detects rowid reuse", async () => {
    const harness = createRealEvoluHarness();
    try {
      const appOwner = testAppOwner(31);
      const shard0 = deriveShardOwner(appOwner, ["messages", 0]);
      const shard1 = deriveShardOwner(appOwner, ["messages", 1]);
      const instance = await harness.openInstance({ appOwner });

      const convId = createIdFromString("conv/1");
      await Effect.runPromise(
        instance.db.mutate([
          {
            kind: "upsert",
            table: "message",
            owner: shard0,
            row: {
              id: createIdFromString("msg/old"),
              conversationId: convId,
              direction: "in",
              content: "old shard",
              wrapId: "wrap-old",
              createdAtSec: 1700000001,
            },
          },
        ]),
      );
      await Effect.runPromise(
        instance.db.mutate([
          {
            kind: "upsert",
            table: "message",
            owner: shard1,
            row: {
              id: createIdFromString("msg/new"),
              conversationId: convId,
              direction: "in",
              content: "new shard",
              wrapId: "wrap-new",
              createdAtSec: 1700000002,
            },
          },
          {
            kind: "upsert",
            table: "contact",
            owner: shard1,
            row: { id: createIdFromString("contact/keep"), name: "Keep" },
          },
        ]),
      );
      // Warm readTable cache before deleting shard0.
      expect(
        await Effect.runPromise(instance.db.readTable("message")),
      ).toHaveLength(2);

      let messageEvents = 0;
      let contactEvents = 0;
      const stopMessage = instance.db.subscribe("message", () => {
        messageEvents += 1;
      });
      const stopContact = instance.db.subscribe("contact", () => {
        contactEvents += 1;
      });
      await waitFor(() => messageEvents >= 1 && contactEvents >= 1);
      messageEvents = 0;
      contactEvents = 0;

      // Deleting shard0 leaves shard1's higher rowid/timestamp intact; count drops 2 -> 1.
      await Effect.runPromise(instance.db.deleteOwner(shard0));
      await waitFor(() => messageEvents >= 1);
      expect(contactEvents).toBe(0);
      expect(
        (await Effect.runPromise(instance.db.readTable("message"))).map(
          (row) => row.content,
        ),
      ).toEqual(["new shard"]);

      stopMessage();
      stopContact();

      // Test rowid reuse directly between two observed digests with the same count:
      // clear the remaining owner so SQLite restarts evolu_history rowids at 1,
      // write one message, snapshot the digest, delete and rewrite an equal-shape
      // message, then compare digests without observing the empty intermediate state.
      const capturedQueries: Array<{
        readonly sql: string;
        readonly parameters: SqliteQueryParameters;
      }> = [];
      const capturingDb = createEvoluShardDb(
        {
          ...instance.evolu,
          subscribeQuery: (query) => {
            const parsed = sqliteQueryStringToSqliteQuery(query);
            capturedQueries.push({
              sql: parsed.sql,
              parameters: parsed.parameters,
            });
            return () => () => {};
          },
        },
        { syncState: syncStore(), hasEvoluRelay: false },
      );
      capturingDb.subscribe("message", () => {})();
      const [digestQuery] = capturedQueries;
      if (!digestQuery) throw new Error("Expected subscribed digest query");
      const { sql, parameters } = digestQuery;
      const readDigest = () =>
        instance
          .rawSqlite()
          .prepare(sql)
          .get(...parameters.map(toSqliteInput));

      await Effect.runPromise(instance.db.deleteOwner(shard1));
      await Effect.runPromise(
        instance.db.mutate([
          {
            kind: "upsert",
            table: "message",
            owner: shard1,
            row: {
              id: createIdFromString("msg/before-reuse"),
              conversationId: convId,
              direction: "in",
              content: "before reuse",
              wrapId: "wrap-before",
              createdAtSec: 1700000003,
            },
          },
        ]),
      );
      const beforeReuse = readDigest();

      await Effect.runPromise(instance.db.deleteOwner(shard1));
      await Effect.runPromise(
        instance.db.mutate([
          {
            kind: "upsert",
            table: "message",
            owner: shard1,
            row: {
              id: createIdFromString("msg/after-reuse"),
              conversationId: convId,
              direction: "in",
              content: "after reuse",
              wrapId: "wrap-after",
              createdAtSec: 1700000004,
            },
          },
        ]),
      );
      const afterReuse = readDigest();

      expect(afterReuse?.count).toBe(beforeReuse?.count);
      expect(afterReuse?.rev).toBe(beforeReuse?.rev);
      expect(afterReuse?.ts).not.toEqual(beforeReuse?.ts);

      await instance.dispose();
    } finally {
      await harness.dispose();
    }
  });
});
