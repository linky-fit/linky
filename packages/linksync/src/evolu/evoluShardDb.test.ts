import { ownerIdToOwnerIdBytes } from "@evolu/common";
import { Effect } from "effect";
import { testAppOwner } from "../testing/toy";
import { createEvoluShardDb, type EvoluRuntime } from "./evoluShardDb";

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
  const mutation =
    (kind: string) =>
    (
      table: string,
      row: Record<string, unknown>,
      options: Record<string, unknown>,
    ) => {
      mutations.push({ kind, table, row, options });
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
      return Promise.resolve(rows);
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
  };
};

describe("evolu shard db", () => {
  it("hands Evolu a SqliteBoolean tombstone, not the port's boolean", async () => {
    const fake = fakeEvolu();
    const db = createEvoluShardDb(fake.runtime);
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
      false,
      true,
      false,
    ]);
  });

  it("serves its own tombstone from the overlay until the row reflects it", async () => {
    const fake = fakeEvolu();
    const db = createEvoluShardDb(fake.runtime);
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

  it("asks evolu_history for the owner id's bytes", async () => {
    const fake = fakeEvolu();
    const db = createEvoluShardDb(fake.runtime);
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
});
