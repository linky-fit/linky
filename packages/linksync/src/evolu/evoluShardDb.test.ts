import { ownerIdToOwnerIdBytes, type OwnerId } from "@evolu/common";
import { Effect } from "effect";
import { testAppOwner } from "../testing/toy";
import {
  createEvoluShardDb,
  type EvoluRuntime,
  type SlowEvoluCall,
  type UnconfirmedWrite,
} from "./evoluShardDb";
import type { OwnerSync } from "./ownerSync";

/**
 * A stand-in for the Evolu instance: records every mutation and query, and
 * answers queries with the rows a test seeds. Enough to check what the
 * adapter hands Evolu, which the in-memory port cannot.
 */
const fakeEvolu = () => {
  const mutations: Array<{
    kind: string;
    table: string;
    row: Record<string, unknown>;
    options: Record<string, unknown>;
  }> = [];
  const queries: string[] = [];
  let rows: ReadonlyArray<Record<string, unknown>> = [];
  let holding = false;
  const held: Array<() => void> = [];
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
      return { ok: true };
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
      if (!holding) return Promise.resolve(answer);
      return new Promise((resolve) => held.push(() => resolve(answer)));
    },
    getQueryRows: () => rows,
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
      holding = true;
    },
    /** Answers new queries again; the held ones stay unanswered. */
    stopHolding: () => {
      holding = false;
    },
    answerQueries: () => {
      for (const answer of held.splice(0)) answer();
      holding = false;
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
      undefined,
      true,
      undefined,
    ]);
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

  it("reports a write Evolu was slow to confirm, with the subscribed load", async () => {
    vi.useFakeTimers();
    try {
      const fake = fakeEvolu();
      const slow: SlowEvoluCall[] = [];
      const db = createEvoluShardDb(
        fake.runtime,
        reportedOwnerSync().ownerSync,
        { onSlowCall: (call) => slow.push(call) },
      );
      const owner = testAppOwner();
      fake.seed([{ id: "m1" }, { id: "m2" }]);
      db.subscribe("message", () => {});
      fake.holdCompletions();
      const write = Effect.runPromise(
        db.mutate([
          {
            kind: "update",
            table: "message",
            ownerId: owner.id,
            row: { id: "m1", content: "edited" },
          },
        ]),
      );
      await vi.advanceTimersByTimeAsync(1_500);
      fake.completeMutations();
      await write;
      expect(slow).toEqual([
        {
          call: "write",
          tables: ["message"],
          ids: ["m1"],
          owners: [owner.id],
          elapsedMs: 1_500,
          answered: true,
          load: {
            subscribedTables: 1,
            subscribedRows: 2,
            pendingWrites: 0,
            pendingReads: 0,
          },
        },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails a read Evolu never answers and retries it with a query Evolu has not cached", async () => {
    vi.useFakeTimers();
    try {
      const fake = fakeEvolu();
      const slow: SlowEvoluCall[] = [];
      const db = createEvoluShardDb(
        fake.runtime,
        reportedOwnerSync().ownerSync,
        { onSlowCall: (call) => slow.push(call) },
      );
      const owner = testAppOwner();
      const row = {
        id: "p1",
        ownerId: owner.id,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: null,
        isDeleted: null,
      };
      fake.seed([row]);
      fake.holdQueries();
      const stuck = Effect.runPromise(Effect.flip(db.readTable("cashuProof")));
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await stuck).toMatchObject({
        _tag: "ShardDbError",
        table: "cashuProof",
        message: "Evolu did not answer the read",
      });
      expect(slow).toMatchObject([
        { call: "readTable", answered: false, elapsedMs: 10_000 },
      ]);

      fake.stopHolding();
      const ids = async () =>
        (await Effect.runPromise(db.readTable("cashuProof"))).map(
          (read) => read.id,
        );
      expect(await ids()).toEqual(["p1"]);
      const [original, retry] = fake.queries;
      expect(retry).not.toEqual(original);
      expect(retry).toContain('["where","id","!=","linksync-retry-1"]');

      fake.answerQueries();
      await vi.advanceTimersByTimeAsync(0);
      expect(slow.at(-1)).toMatchObject({ call: "readTable", answered: true });
      await ids();
      expect(fake.queries.at(-1)).toEqual(original);
    } finally {
      vi.useRealTimers();
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
    const copies = await Effect.runPromise(db.readCopies("reaction", "r1"));
    expect(copies.map((row) => [row.id, row.emoji])).toEqual([["r1", "👍"]]);
    expect(fake.queries.at(-1)).toContain('["where","id","=","r1"]');
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
