import { ownerIdToOwnerIdBytes, type OwnerId } from "@evolu/common";
import { createQuery, deserializeQuery } from "@evolu/common/local-first";
import { Effect } from "effect";
import { DatabaseSync } from "node:sqlite";
import { testAppOwner } from "../testing/toy";
import {
  createEvoluShardDb,
  type EvoluRuntime,
  type UnconfirmedWrite,
} from "./evoluShardDb";
import type { OwnerSync } from "./ownerSync";

/**
 * A stand-in for the Evolu instance: records every mutation and query, and
 * answers queries with the rows a test seeds. Enough to check what the
 * adapter hands Evolu, which the in-memory port cannot.
 */
const fakeEvolu = (
  rejects: (row: Record<string, unknown>) => boolean = () => false,
) => {
  const mutations: Array<{
    kind: string;
    table: string;
    row: Record<string, unknown>;
    options: Record<string, unknown>;
  }> = [];
  const queries: string[] = [];
  let rows: ReadonlyArray<Record<string, unknown>> = [];
  let held: Array<() => void> | null = null;
  let heldCompletions: Array<() => void> | null = null;
  const mutation =
    (kind: string) =>
    (
      table: string,
      row: Record<string, unknown>,
      options: Record<string, unknown>,
    ) => {
      mutations.push({ kind, table, row, options });
      const { onComplete } = options;
      if (typeof onComplete === "function") {
        const complete = () => {
          onComplete();
        };
        if (heldCompletions === null) queueMicrotask(complete);
        else heldCompletions.push(complete);
      }
      return rejects(row) ? { ok: false, error: "invalid" } : { ok: true };
    };
  const evolu = {
    useOwner: () => () => {},
    createQuery: (build: (db: unknown) => unknown) => {
      type Arg = string | number | object;
      const parts: Array<[string | symbol, ...Arg[]]> = [];
      const builder: Record<string, unknown> = new Proxy(
        {},
        {
          get:
            (_target, method) =>
            (...args: Arg[]) => {
              parts.push([method, ...args]);
              return builder;
            },
        },
      );
      build(builder);
      return JSON.stringify(parts, (_key, value: unknown) =>
        value instanceof Uint8Array ? `bytes:${value.length}` : value,
      );
    },
    loadQuery: (query: string) => {
      queries.push(query);
      const answer = rows;
      if (held === null) return Promise.resolve(answer);
      const waiting = held;
      return new Promise((resolve) => waiting.push(() => resolve(answer)));
    },
    subscribeQuery: () => () => () => {},
    upsert: mutation("upsert"),
    update: mutation("update"),
  };
  const runtime: EvoluRuntime = evolu;
  return {
    runtime,
    mutations,
    queries,
    seed: (next: ReadonlyArray<Record<string, unknown>>) => {
      rows = next;
    },
    holdQueries: () => {
      held = [];
    },
    answerQueries: () => {
      for (const answer of held ?? []) answer();
      held = null;
    },
    holdCompletions: () => {
      heldCompletions = [];
    },
    completeMutations: () => {
      for (const complete of heldCompletions ?? []) complete();
      heldCompletions = null;
    },
  };
};

/** The page side of the worker's owner sync reports, driven by the test. */
const reportedOwnerSync = () => {
  const synced = new Set<OwnerId>();
  const listeners = new Set<() => void>();
  const ownerSync: OwnerSync = {
    syncedOwners: () => synced,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeFailures: () => () => {},
  };
  return {
    ownerSync,
    report: (ownerId: OwnerId) => {
      synced.add(ownerId);
      for (const listener of listeners) listener();
    },
  };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("evolu shard db", () => {
  it("hands Evolu a SqliteBoolean tombstone, not the port's boolean", async () => {
    const fake = fakeEvolu();
    const db = createEvoluShardDb(fake.runtime, reportedOwnerSync().ownerSync);
    const owner = testAppOwner();
    await Effect.runPromise(
      db.mutate([
        {
          kind: "update",
          table: "cashuProof",
          ownerId: owner.id,
          row: { id: "p1", isDeleted: true },
        },
        {
          kind: "update",
          table: "cashuProof",
          ownerId: owner.id,
          row: { id: "p2", state: "spent" },
        },
      ]),
    );
    const applied = fake.mutations.filter(
      (m) => m.options.onlyValidate !== true,
    );
    expect(applied.map((m) => m.row)).toEqual([
      { id: "p1", isDeleted: 1 },
      { id: "p2", state: "spent" },
    ]);
    expect(fake.mutations.map((m) => m.options.onlyValidate)).toEqual([
      true,
      true,
      undefined,
      undefined,
    ]);
  });

  it("queues a whole batch at once, and none of it when Evolu would reject one row", async () => {
    const fake = fakeEvolu((row) => row.id === "bad");
    const db = createEvoluShardDb(fake.runtime, reportedOwnerSync().ownerSync);
    const owner = testAppOwner();
    const queued = () =>
      fake.mutations
        .filter(({ options }) => options.onlyValidate !== true)
        .map(({ row }) => row.id);
    const proofRow = (id: string) => ({
      kind: "upsert" as const,
      table: "cashuProof",
      ownerId: owner.id,
      row: { id, state: "spent" },
    });

    const write = Effect.runPromise(
      db.mutate([proofRow("p1"), proofRow("p2"), proofRow("p3")]),
    );
    // Evolu makes one transaction of what is queued before its microtask runs.
    expect(queued()).toEqual(["p1", "p2", "p3"]);
    await write;

    const rejected = await Effect.runPromise(
      Effect.flip(db.mutate([proofRow("p4"), proofRow("bad")])),
    );
    expect(rejected).toMatchObject({ _tag: "ShardDbError" });
    expect(queued()).toEqual(["p1", "p2", "p3"]);
    expect(
      (await Effect.runPromise(db.readTable("cashuProof"))).map(
        (row) => row.id,
      ),
    ).not.toContain("p4");
  });

  it("resolves a write only once Evolu has applied it", async () => {
    const fake = fakeEvolu();
    const db = createEvoluShardDb(fake.runtime, reportedOwnerSync().ownerSync);
    const owner = testAppOwner();
    fake.holdCompletions();
    let written = false;
    const write = Effect.runPromise(
      db.mutate([
        {
          kind: "update",
          table: "cashuProof",
          ownerId: owner.id,
          row: { id: "p1", state: "spent" },
        },
      ]),
    ).then(() => {
      written = true;
    });
    await settle();
    expect(written).toBe(false);

    fake.completeMutations();
    await write;
    expect(written).toBe(true);
  });

  it("fails a write Evolu never confirms once the bound passes and stops serving it", async () => {
    vi.useFakeTimers();
    try {
      const fake = fakeEvolu();
      const unconfirmed: UnconfirmedWrite[] = [];
      const db = createEvoluShardDb(
        fake.runtime,
        reportedOwnerSync().ownerSync,
        { onWriteUnconfirmed: (write) => unconfirmed.push(write) },
      );
      const owner = testAppOwner();
      fake.holdCompletions();
      const write = Effect.runPromise(
        Effect.flip(
          db.mutate([
            {
              kind: "upsert",
              table: "cashuProof",
              ownerId: owner.id,
              row: { id: "p1", state: "spent" },
            },
          ]),
        ),
      );
      await vi.advanceTimersByTimeAsync(9_000);
      expect(unconfirmed).toEqual([]);
      expect(
        (await Effect.runPromise(db.readTable("cashuProof"))).map(
          (row) => row.id,
        ),
      ).toEqual(["p1"]);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(await write).toMatchObject({
        _tag: "ShardDbError",
        message: "Evolu did not confirm the write",
      });
      expect(unconfirmed).toEqual([
        { table: "cashuProof", ownerId: owner.id, id: "p1" },
      ]);
      expect(await Effect.runPromise(db.readTable("cashuProof"))).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads omitted columns as null before a sparse write reaches the query", async () => {
    const fake = fakeEvolu();
    const db = createEvoluShardDb(fake.runtime, reportedOwnerSync().ownerSync);
    await Effect.runPromise(
      db.mutate([
        {
          kind: "upsert",
          table: "onchainTransfer",
          ownerId: testAppOwner().id,
          row: { id: "transfer-1", amount: 100_000 },
        },
      ]),
    );
    for (const rows of [
      await Effect.runPromise(db.readTable("onchainTransfer")),
      await Effect.runPromise(db.readCopies("onchainTransfer", ["transfer-1"])),
    ]) {
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: "transfer-1",
        amount: 100_000,
        createdAtSec: null,
        cancelledAtSec: null,
        refundAddress: null,
      });
    }
  });

  it("serves its own tombstone from the overlay until the row reflects it", async () => {
    const fake = fakeEvolu();
    const db = createEvoluShardDb(fake.runtime, reportedOwnerSync().ownerSync);
    const owner = testAppOwner();
    fake.seed([
      {
        id: "p1",
        ownerId: owner.id,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: null,
        isDeleted: null,
        state: "available",
      },
    ]);
    await Effect.runPromise(
      db.mutate([
        {
          kind: "update",
          table: "cashuProof",
          ownerId: owner.id,
          row: { id: "p1", isDeleted: true },
        },
      ]),
    );
    const rows = await Effect.runPromise(db.readTable("cashuProof"));
    expect(rows.map((row) => row.isDeleted)).toEqual([1]);
  });

  it("reads back a tombstone an update created, which has no createdAt", async () => {
    const fake = fakeEvolu();
    const db = createEvoluShardDb(fake.runtime, reportedOwnerSync().ownerSync);
    const owner = testAppOwner();
    fake.seed([
      {
        id: "r1",
        ownerId: owner.id,
        createdAt: null,
        updatedAt: "2026-01-02T00:00:00.000Z",
        isDeleted: 1,
        reactorPubkey: "pk",
      },
    ]);
    const rows = await Effect.runPromise(db.readTable("reaction"));
    expect(rows).toEqual([
      expect.objectContaining({
        id: "r1",
        isDeleted: 1,
        createdAt: "2026-01-02T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      }),
    ]);
  });

  it("reads one row's copies by id, its own pending write included", async () => {
    const fake = fakeEvolu();
    const db = createEvoluShardDb(fake.runtime, reportedOwnerSync().ownerSync);
    const owner = testAppOwner();
    await Effect.runPromise(
      db.mutate([
        {
          kind: "upsert",
          table: "reaction",
          ownerId: owner.id,
          row: { id: "r1", emoji: "👍" },
        },
        {
          kind: "upsert",
          table: "reaction",
          ownerId: owner.id,
          row: { id: "r2", emoji: "👎" },
        },
      ]),
    );
    const copies = await Effect.runPromise(db.readCopies("reaction", ["r1"]));
    expect(copies.map((row) => [row.id, row.emoji])).toEqual([["r1", "👍"]]);
    expect(fake.queries.at(-1)).toContain('["where","id","in",["r1"]]');
  });

  it("asks evolu_history for the owner id's bytes", async () => {
    const fake = fakeEvolu();
    const db = createEvoluShardDb(fake.runtime, reportedOwnerSync().ownerSync);
    const owner = testAppOwner();
    fake.seed([{ mutations: 3, bytes: 40 }]);
    expect(await Effect.runPromise(db.ownerUsage(owner.id))).toEqual({
      mutations: 3,
      bytes: 40,
    });
    expect(fake.queries[0]).toContain(
      `"=","bytes:${ownerIdToOwnerIdBytes(owner.id).length}"`,
    );
    expect(fake.queries[0]).not.toContain(owner.id);
  });

  it("counts a reported owner synced once a fresh query has answered", async () => {
    const fake = fakeEvolu();
    const sync = reportedOwnerSync();
    const owner = testAppOwner();
    const db = createEvoluShardDb(fake.runtime, sync.ownerSync);
    let notified = 0;
    db.subscribeOwnerSync(() => {
      notified += 1;
    });
    fake.holdQueries();
    sync.report(owner.id);
    await settle();
    expect(db.isOwnerSynced(owner.id)).toBe(false);
    expect(fake.queries.at(-1)).toContain("linksync-barrier-1");

    fake.answerQueries();
    await settle();
    expect(db.isOwnerSynced(owner.id)).toBe(true);
    expect(notified).toBe(1);
  });

  it("takes owners the worker reported before the db was created", async () => {
    const fake = fakeEvolu();
    const sync = reportedOwnerSync();
    const owner = testAppOwner();
    sync.report(owner.id);
    const db = createEvoluShardDb(fake.runtime, sync.ownerSync);
    await settle();
    expect(db.isOwnerSynced(owner.id)).toBe(true);
  });
});

/**
 * Evolu's own query compiler over a real SQLite table, so the SQL the
 * adapter builds is what decides which rows come back. Writes go through
 * the fake and stay in the adapter's overlay.
 */
const sqliteEvolu = () => {
  const sqlite = new DatabaseSync(":memory:");
  const loaded: Array<ReadonlyArray<Record<string, unknown>>> = [];
  sqlite.exec(
    `create table cashuProof (id text, ownerId text, createdAt text, updatedAt text,
      isDeleted integer, state text, operationId text, keysetId text, mint text)`,
  );
  const evolu = {
    ...fakeEvolu().runtime,
    createQuery,
    loadQuery: (query: Parameters<typeof deserializeQuery>[0]) => {
      const { sql, parameters } = deserializeQuery(query);
      const rows = sqlite
        .prepare(sql)
        .all(
          ...parameters.filter(
            (value) => typeof value === "string" || typeof value === "number",
          ),
        );
      loaded.push(rows);
      return Promise.resolve(rows);
    },
  };
  const runtime: EvoluRuntime = evolu;
  const insert = (row: {
    readonly id: string;
    readonly ownerId: OwnerId;
    readonly createdAt: string;
    readonly isDeleted?: 1;
    readonly state?: string;
    readonly keysetId?: string;
    readonly mint?: string;
  }) =>
    sqlite
      .prepare(
        `insert into cashuProof (id, ownerId, createdAt, updatedAt, isDeleted, state, keysetId, mint)
          values (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.ownerId,
        row.createdAt,
        row.createdAt,
        row.isDeleted ?? null,
        row.state ?? null,
        row.keysetId ?? null,
        row.mint ?? null,
      );
  return { runtime, insert, loaded };
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
    const { runtime, insert, loaded } = sqliteEvolu();
    const db = createEvoluShardDb(runtime, reportedOwnerSync().ownerSync);
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

  it("returns a pending write that newly matches together with its stored copies", async () => {
    const { runtime, insert } = sqliteEvolu();
    const db = createEvoluShardDb(runtime, reportedOwnerSync().ownerSync);
    insert({ id: "p1", ownerId: older, createdAt: at, state: "spent" });
    await Effect.runPromise(
      db.mutate([
        {
          kind: "upsert",
          table: "cashuProof",
          ownerId: newer,
          row: { id: "p1", state: "available" },
        },
      ]),
    );

    const rows = await Effect.runPromise(
      db.readCopiesWhere("cashuProof", "state", unspent),
    );

    expect(
      rows.map((row) => [row.ownerId === older ? 0 : 1, row.state]).sort(),
    ).toEqual([
      [0, "spent"],
      [1, "available"],
    ]);
  });

  it("reads the earliest created copy per value among the given owners", async () => {
    const { runtime, insert } = sqliteEvolu();
    const db = createEvoluShardDb(runtime, reportedOwnerSync().ownerSync);
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
      db.readOldest("cashuProof", "keysetId", ["00aa", "00bb"], [older, newer]),
    );

    expect(rows.map((row) => row.mint)).toEqual(["first"]);
  });
});
