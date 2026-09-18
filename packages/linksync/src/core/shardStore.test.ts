import { Effect } from "effect";
import {
  run,
  testAppOwner,
  tick,
  toyScopes,
  toyStore,
  type ToySchema,
} from "../testing/toy";
import { createShardStore, shardPointerId } from "./shardStore";

const note = (id: string, title = `title ${id}`) => ({ id, title });

describe("shard store", () => {
  describe("writes", () => {
    it("inserts into the active shard", () => {
      const { db, store } = toyStore();
      run(store.insert("notes", "note", note("a")));
      const rows = run(db.readTable("note"));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.ownerId).toBe(store.shardOwner("notes", 0).id);
    });

    it("sends inserts to the new shard after a rotation and never to the old one", () => {
      const { db, store } = toyStore();
      run(store.insert("notes", "note", note("a")));
      run(store.rotate("notes"));
      run(store.insert("notes", "note", note("b")));
      const byOwner = new Map(
        run(db.readTable("note")).map((row) => [row.id, row.ownerId]),
      );
      expect(byOwner.get("a")).toBe(store.shardOwner("notes", 0).id);
      expect(byOwner.get("b")).toBe(store.shardOwner("notes", 1).id);
    });

    it("patches a row of the active shard in place", () => {
      const { db, store } = toyStore();
      run(store.insert("notes", "note", note("a")));
      run(store.update("notes", "note", "a", { body: "text" }));
      const rows = run(db.readTable("note"));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: "a",
        title: "title a",
        body: "text",
      });
    });

    it("copies a row of an old shard into the active shard and tombstones the old copy", () => {
      const { db, store } = toyStore();
      run(store.insert("notes", "note", { ...note("a"), body: "old" }));
      run(store.rotate("notes"));
      run(store.update("notes", "note", "a", { title: "renamed" }));

      const shard0 = store.shardOwner("notes", 0).id;
      const shard1 = store.shardOwner("notes", 1).id;
      const rows = run(db.readTable("note"));
      const old = rows.find((row) => row.ownerId === shard0);
      const copy = rows.find((row) => row.ownerId === shard1);
      expect(old).toMatchObject({ id: "a", title: "title a", isDeleted: 1 });
      expect(copy).toMatchObject({
        id: "a",
        title: "renamed",
        body: "old",
        isDeleted: null,
      });

      const visible = run(store.rows("notes", "note"));
      expect(visible).toHaveLength(1);
      expect(visible[0]).toMatchObject({ title: "renamed", ownerId: shard1 });
    });

    it("fails to update an unknown row", () => {
      const { store } = toyStore();
      const exit = run(Effect.exit(store.update("notes", "note", "nope", {})));
      expect(exit._tag).toBe("Failure");
    });

    it("tombstones a removed row where it lives", () => {
      const { db, store } = toyStore();
      run(store.insert("notes", "note", note("a")));
      run(store.rotate("notes"));
      run(store.remove("notes", "note", "a"));
      const rows = run(db.readTable("note"));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        isDeleted: 1,
        ownerId: store.shardOwner("notes", 0).id,
      });
      expect(run(store.rows("notes", "note"))).toEqual([]);
    });

    it("removes an already tombstoned row without another mutation", () => {
      const { db, store } = toyStore();
      run(store.insert("notes", "note", note("a")));
      run(store.rotate("notes"));
      run(store.update("notes", "note", "a", { title: "copied" }));
      run(store.remove("notes", "note", "a"));
      const before = run(db.readTable("note"));
      const usage = run(db.ownerUsage(store.shardOwner("notes", 1).id));
      run(store.remove("notes", "note", "a"));
      expect(run(db.readTable("note"))).toEqual(before);
      expect(run(db.ownerUsage(store.shardOwner("notes", 1).id))).toEqual(
        usage,
      );
      expect(run(store.rows("notes", "note"))).toEqual([]);
      expect(
        run(Effect.exit(store.remove("notes", "note", "unknown")))._tag,
      ).toBe("Failure");
    });

    it("writes app-scope rows into the app owner", () => {
      const { db, store, appOwner } = toyStore();
      run(store.insert("meta", "setting", { id: "lang", value: "cs" }));
      expect(run(db.readTable("setting"))[0]?.ownerId).toBe(appOwner.id);
    });
  });

  describe("merged reads", () => {
    it("returns the copy from the highest shard when an id exists in several", () => {
      const { db, store } = toyStore();
      const shard0 = store.shardOwner("notes", 0).id;
      const shard2 = store.shardOwner("notes", 2).id;
      run(store.rotate("notes"));
      run(store.rotate("notes"));
      run(
        db.mutate([
          {
            kind: "upsert",
            table: "note",
            ownerId: shard2,
            row: note("a", "new"),
          },
          {
            kind: "upsert",
            table: "note",
            ownerId: shard0,
            row: note("a", "old"),
          },
        ]),
      );
      const rows = run(store.rows("notes", "note"));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.title).toBe("new");
    });

    it("ignores rows of owners outside the visible shards", () => {
      const { db, store } = toyStore();
      const foreign = testAppOwner(9);
      run(
        db.mutate([
          {
            kind: "upsert",
            table: "note",
            ownerId: foreign.id,
            row: note("x"),
          },
        ]),
      );
      expect(run(store.rows("notes", "note"))).toEqual([]);
      expect(run(store.foreignRows("note", foreign.id))).toHaveLength(1);
    });
  });

  describe("rotation", () => {
    it("does not rotate a fixed scope", () => {
      const { store } = toyStore();
      expect(run(store.maybeRotate("meta"))).toEqual({
        rotated: false,
        reason: "fixed",
      });
    });

    it("rotates once the mutation threshold is reached", () => {
      const { store } = toyStore();
      run(store.insert("notes", "note", note("a")));
      run(store.insert("notes", "note", note("b")));
      expect(run(store.maybeRotate("notes"))).toEqual({
        rotated: false,
        reason: "belowThreshold",
      });
      run(store.insert("notes", "note", note("c")));
      expect(run(store.maybeRotate("notes"))).toEqual({
        rotated: true,
        index: 1,
      });
      expect(run(store.activeIndex("notes"))).toBe(1);
    });

    it("rotates once the byte threshold is reached", () => {
      const { store } = toyStore();
      run(store.insert("notes", "note", note("a", "x".repeat(1_000))));
      expect(run(store.maybeRotate("notes"))).toMatchObject({ rotated: true });
    });

    it("honors the cooldown between rotations", () => {
      const { store } = toyStore();
      const fill = () =>
        ["a", "b", "c"].forEach((id) =>
          run(store.insert("notes", "note", note(id))),
        );
      fill();
      tick(1);
      expect(run(store.maybeRotate("notes"))).toMatchObject({ rotated: true });
      fill();
      expect(run(store.maybeRotate("notes"))).toEqual({
        rotated: false,
        reason: "cooldown",
      });
      tick(1_000);
      expect(run(store.maybeRotate("notes"))).toEqual({
        rotated: true,
        index: 2,
      });
    });

    it("keeps a locally written index until the read model shows it", () => {
      const { db, appOwner } = toyStore();
      let pointerVisible = true;
      const lagging: typeof db = {
        ...db,
        readTable: (table) =>
          table === "shardPointer" && !pointerVisible
            ? Effect.succeed([])
            : db.readTable(table),
      };
      const store = createShardStore<ToySchema, typeof toyScopes>({
        db: lagging,
        appOwner,
        scopes: toyScopes,
      });
      pointerVisible = false;
      run(store.rotate("notes"));
      expect(run(store.activeIndex("notes"))).toBe(1);
      run(store.insert("notes", "note", note("a")));
      expect(run(db.readTable("note"))[0]?.ownerId).toBe(
        store.shardOwner("notes", 1).id,
      );
      pointerVisible = true;
      expect(run(store.activeIndex("notes"))).toBe(1);
    });
  });

  describe("subscribe set", () => {
    it("includes the app owner and every shard of a never-forget scope", () => {
      const { db, store, appOwner } = toyStore();
      run(store.rotate("notes"));
      run(store.rotate("notes"));
      run(store.reconcileSync());
      const used = new Set(db.usedOwners());
      expect(used.has(appOwner.id)).toBe(true);
      for (const index of [0, 1, 2])
        expect(used.has(store.shardOwner("notes", index).id)).toBe(true);
    });

    it("keeps existing shards until an explicit forget", () => {
      const { db, store } = toyStore();
      run(store.reconcileSync());
      expect(db.usedOwners()).toContain(store.shardOwner("chats", 0).id);
      for (let i = 0; i < 3; i += 1) run(store.rotate("chats"));
      run(store.reconcileSync());
      expect(db.usedOwners()).toContain(store.shardOwner("chats", 0).id);
      run(store.forget("chats"));
      const used = new Set(db.usedOwners());
      expect(used.has(store.shardOwner("chats", 0).id)).toBe(false);
      expect(used.has(store.shardOwner("chats", 1).id)).toBe(false);
      expect(used.has(store.shardOwner("chats", 2).id)).toBe(true);
      expect(used.has(store.shardOwner("chats", 3).id)).toBe(true);
      expect(run(store.visibleShards("chats")).map((s) => s.index)).toEqual([
        2, 3,
      ]);
    });
  });

  it("persists retention on the first observation and only when it changes", () => {
    const { db, appOwner } = toyStore();
    const writes: Array<{ scope: string; first: number }> = [];
    const store = createShardStore<ToySchema, typeof toyScopes>({
      db,
      appOwner,
      scopes: toyScopes,
      retention: {
        get: () => undefined,
        set: (scope, first) => {
          writes.push({ scope, first });
        },
      },
    });
    run(store.insert("chats", "chat", { id: "a", text: "first" }));
    expect(writes).toEqual([{ scope: "chats", first: 0 }]);
    run(store.insert("chats", "chat", { id: "b", text: "second" }));
    run(store.update("chats", "chat", "a", { text: "edited" }));
    run(store.retainVisibleShards());
    expect(writes).toEqual([{ scope: "chats", first: 0 }]);
    run(store.rotate("chats"));
    run(store.rotate("chats"));
    run(store.forget("chats"));
    expect(writes).toEqual([
      { scope: "chats", first: 0 },
      { scope: "chats", first: 1 },
    ]);
    run(store.insert("chats", "chat", { id: "c", text: "after forget" }));
    run(store.forget("chats"));
    expect(writes).toHaveLength(2);
  });

  it("a fresh store follows only the newest window and persists explicit forgetting across reloads", () => {
    const { db, store, appOwner } = toyStore();
    run(store.insert("chats", "chat", { id: "old", text: "hi" }));
    for (let i = 0; i < 3; i += 1) run(store.rotate("chats"));
    const saved = new Map<string, number>();
    const retention = {
      get: (scope: string) => saved.get(scope),
      set: (scope: string, first: number) => {
        saved.set(scope, first);
      },
    };
    const reopen = () =>
      createShardStore<ToySchema, typeof toyScopes>({
        db: { ...db, deleteOwner: null },
        appOwner,
        scopes: toyScopes,
        retention,
      });
    const existing = reopen();
    expect(run(existing.rows("chats", "chat"))).toHaveLength(1);
    let changed = 0;
    existing.subscribe("chats", () => {
      changed += 1;
    });
    expect(run(existing.forget("chats"))).toEqual([
      { scope: "chats", index: 0, deleted: false },
      { scope: "chats", index: 1, deleted: false },
    ]);
    expect(changed).toBe(1);
    expect(run(db.readTable("chat"))).toHaveLength(1);
    expect(run(reopen().rows("chats", "chat"))).toEqual([]);
    const freshDb = {
      ...db,
      readTable: <T extends keyof ToySchema & string>(table: T) =>
        table === "shardPointer" ? db.readTable(table) : Effect.succeed([]),
    };
    const fresh = createShardStore<ToySchema, typeof toyScopes>({
      db: freshDb,
      appOwner,
      scopes: toyScopes,
    });
    expect(
      run(fresh.visibleShards("chats")).map((shard) => shard.index),
    ).toEqual([2, 3]);
  });

  it("retains a subscribed shard zero when another device jumps several pointers ahead", () => {
    const { db, appOwner } = toyStore();
    const setPointer = (index: number) =>
      run(
        db.mutate([
          {
            kind: "upsert",
            table: "shardPointer",
            ownerId: appOwner.id,
            row: { id: shardPointerId("chats"), scope: "chats", index },
          },
        ]),
      );
    setPointer(0);
    const store = createShardStore<ToySchema, typeof toyScopes>({
      db,
      appOwner,
      scopes: toyScopes,
    });
    run(store.reconcileSync());
    run(store.retainVisibleShards());
    setPointer(3);
    expect(
      run(store.visibleShards("chats")).map((shard) => shard.index),
    ).toEqual([0, 1, 2, 3]);
    run(store.forget("chats"));
    expect(
      run(store.visibleShards("chats")).map((shard) => shard.index),
    ).toEqual([2, 3]);
  });

  it("does not retain provisional windows while a fresh device hydrates pointers", () => {
    const { db, appOwner } = toyStore();
    const store = createShardStore<ToySchema, typeof toyScopes>({
      db,
      appOwner,
      scopes: toyScopes,
    });
    for (const index of [0, 1, 3]) {
      run(
        db.mutate([
          {
            kind: "upsert",
            table: "shardPointer",
            ownerId: appOwner.id,
            row: { id: shardPointerId("chats"), scope: "chats", index },
          },
        ]),
      );
      run(store.reconcileSync());
    }
    expect(
      run(store.visibleShards("chats")).map((shard) => shard.index),
    ).toEqual([2, 3]);
    run(store.retainVisibleShards());
    run(
      db.mutate([
        {
          kind: "upsert",
          table: "shardPointer",
          ownerId: appOwner.id,
          row: { id: shardPointerId("chats"), scope: "chats", index: 5 },
        },
      ]),
    );
    expect(
      run(store.visibleShards("chats")).map((shard) => shard.index),
    ).toEqual([2, 3, 4, 5]);
  });

  describe("forget", () => {
    it("deletes shards that fell out of the window when the port can", () => {
      const { db, store } = toyStore();
      run(store.insert("chats", "chat", { id: "old", text: "hi" }));
      for (let i = 0; i < 2; i += 1) run(store.rotate("chats"));
      run(store.insert("chats", "chat", { id: "new", text: "yo" }));
      expect(run(store.forget())).toEqual([
        { scope: "chats", index: 0, deleted: true },
      ]);
      expect(run(db.readTable("chat")).map((row) => row.id)).toEqual(["new"]);
      expect(db.usedOwners()).not.toContain(store.shardOwner("chats", 0).id);
    });

    it("forgets nothing for never-forget scopes", () => {
      const { store } = toyStore();
      for (let i = 0; i < 3; i += 1) run(store.rotate("notes"));
      expect(run(store.forget())).toEqual([]);
    });
  });

  describe("legacy ingest", () => {
    const legacy = testAppOwner(5);
    const seedLegacy = (db: ReturnType<typeof toyStore>["db"]) =>
      run(
        db.mutate([
          { kind: "upsert", table: "note", ownerId: legacy.id, row: note("a") },
          { kind: "upsert", table: "note", ownerId: legacy.id, row: note("b") },
          {
            kind: "update",
            table: "note",
            ownerId: legacy.id,
            row: { id: "b", isDeleted: true },
          },
        ]),
      );

    it("copies live foreign rows into the active shard once", () => {
      const { db, store } = toyStore();
      seedLegacy(db);
      const legacyRows = () => run(store.foreignRows("note", legacy.id));
      expect(run(store.ingest("notes", "note", legacyRows()))).toEqual({
        ingested: 1,
      });
      expect(run(store.rows("notes", "note")).map((row) => row.id)).toEqual([
        "a",
      ]);
      expect(run(store.ingest("notes", "note", legacyRows()))).toEqual({
        ingested: 0,
      });
    });

    it("re-ingests a row the legacy owner updated later", () => {
      const { db, store } = toyStore();
      seedLegacy(db);
      run(
        store.ingest(
          "notes",
          "note",
          run(store.foreignRows("note", legacy.id)),
        ),
      );
      tick(1);
      run(
        db.mutate([
          {
            kind: "update",
            table: "note",
            ownerId: legacy.id,
            row: { id: "a", title: "later" },
          },
        ]),
      );
      expect(
        run(
          store.ingest(
            "notes",
            "note",
            run(store.foreignRows("note", legacy.id)),
          ),
        ),
      ).toEqual({ ingested: 1 });
      expect(run(store.rows("notes", "note"))[0]?.title).toBe("later");
    });

    it("does not resurrect a row the shards have deleted", () => {
      const { db, store } = toyStore();
      seedLegacy(db);
      run(
        store.ingest(
          "notes",
          "note",
          run(store.foreignRows("note", legacy.id)),
        ),
      );
      tick(1);
      run(store.remove("notes", "note", "a"));
      expect(
        run(
          store.ingest(
            "notes",
            "note",
            run(store.foreignRows("note", legacy.id)),
          ),
        ),
      ).toEqual({ ingested: 0 });
      expect(run(store.rows("notes", "note"))).toEqual([]);
    });
  });

  it("reports pointer changes and subscribes the new shard", async () => {
    const { db, store } = toyStore();
    const rotations: Array<{ scope: string; index: number }> = [];
    const stop = store.followPointers((rotation) => rotations.push(rotation));
    await Promise.resolve();
    run(store.rotate("notes"));
    await new Promise((resolve) => setTimeout(resolve));
    expect(rotations).toEqual([{ scope: "notes", index: 1 }]);
    expect(db.usedOwners()).toContain(store.shardOwner("notes", 1).id);
    stop();
    run(store.rotate("notes"));
    await new Promise((resolve) => setTimeout(resolve));
    expect(rotations).toHaveLength(1);
  });

  it("notifies subscribers of the scope's tables", () => {
    const { store } = toyStore();
    let calls = 0;
    const unsubscribe = store.subscribe("notes", () => {
      calls += 1;
    });
    run(store.insert("notes", "note", note("a")));
    run(store.insert("chats", "chat", { id: "c", text: "x" }));
    unsubscribe();
    run(store.insert("notes", "note", note("b")));
    expect(calls).toBe(1);
  });
});
