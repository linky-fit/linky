import * as Evolu from "@evolu/common";
import { NewTokenRow, TokenState, TokenText } from "@linky/linkshu";
import type { TokenStoreService } from "@linky/linkshu";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { CashuTokenRow } from "../../evolu";
import { createCashuTokenRowFixture } from "../../testUtils/cashuTokenRow";
import { makeEvoluTokenStore } from "./evoluTokenStore";

const oldOwnerId = Evolu.OwnerId.orThrow("AAAAAAAAAAAAAAAAAAAAAA");
const activeOwnerId = Evolu.OwnerId.orThrow("AQEBAQEBAQEBAQEBAQEBAQ");

const newRow = (input: {
  error?: string;
  originalTokenText?: string;
  state?: TokenState;
  tokenText: string;
}): NewTokenRow =>
  new NewTokenRow({
    error: input.error ?? null,
    originalTokenText: TokenText.make(
      input.originalTokenText ?? input.tokenText,
    ),
    state: input.state ?? "accepted",
    tokenText: TokenText.make(input.tokenText),
  });

/**
 * In-memory stand-in for the Evolu `cashuToken` table, faithful to the parts
 * the adapter depends on: rows are keyed by `(ownerId, id)` and an update
 * through the wrong owner lane leaves the real row untouched. With `lagging`,
 * `loadTokenRows` serves a stale snapshot that only advances on `sync()` — the
 * React render state the real adapter reads lags Evolu mutations the same way.
 */
const makeFakeCashuTable = ({ lagging = false } = {}) => {
  const rows = new Map<string, CashuTokenRow>();
  let snapshot: CashuTokenRow[] = [];
  const keyOf = (ownerId: string, id: string) => `${ownerId}|${id}`;

  const seed = (row: CashuTokenRow): void => {
    rows.set(keyOf(row.ownerId, row.id), row);
  };
  const sync = (): void => {
    snapshot = [...rows.values()];
  };

  const store: TokenStoreService = makeEvoluTokenStore({
    getWriteOwnerId: () => activeOwnerId,
    loadTokenRows: () =>
      Promise.resolve(lagging ? snapshot : [...rows.values()]),
    update: (_table, payload, options) => {
      const key = keyOf(options.ownerId, payload.id);
      const existing = rows.get(key);
      if (existing === undefined) return { ok: true };
      rows.set(key, {
        ...existing,
        ...(payload.error !== undefined ? { error: payload.error } : {}),
        ...(payload.isDeleted !== undefined
          ? { isDeleted: payload.isDeleted }
          : {}),
        ...(payload.state !== undefined ? { state: payload.state } : {}),
        ...(payload.token !== undefined ? { token: payload.token } : {}),
      });
      return { ok: true };
    },
    upsert: (_table, payload, options) => {
      const key = keyOf(options.ownerId, payload.id);
      const existing = rows.get(key);
      const base =
        existing ??
        createCashuTokenRowFixture({
          createdAt: new Date().toISOString(),
          ownerId: options.ownerId,
          token: payload.token,
        });
      rows.set(key, {
        ...base,
        error: payload.error ?? null,
        id: payload.id,
        originalTokenText: payload.originalTokenText,
        state: payload.state,
        token: payload.token,
      });
      return { ok: true };
    },
  });

  return { seed, store, sync };
};

const loadAll = (store: TokenStoreService) => Effect.runPromise(store.loadAll);

describe("makeEvoluTokenStore", () => {
  it("round-trips a new row through insert and loadAll", async () => {
    const { store } = makeFakeCashuTable();

    const inserted = await Effect.runPromise(
      store.insert(
        newRow({
          originalTokenText: "cashuAoriginal",
          state: "pending",
          tokenText: "cashuAcurrent",
        }),
      ),
    );

    const rows = await loadAll(store);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      error: null,
      id: inserted.id,
      originalTokenText: "cashuAoriginal",
      state: "pending",
      tokenText: "cashuAcurrent",
    });
    expect(rows[0].createdAt).toBeGreaterThan(0);
  });

  it("round-trips all six canonical states unchanged", async () => {
    const { store } = makeFakeCashuTable();
    const states = TokenState.literals;

    for (const state of states) {
      await Effect.runPromise(
        store.insert(newRow({ state, tokenText: `cashuA${state}` })),
      );
    }

    const rows = await loadAll(store);
    expect(rows.map((row) => row.state).sort()).toEqual([...states].sort());
  });

  it("round-trips a linkshu-written tagged error unchanged", async () => {
    const { store } = makeFakeCashuTable();
    const taggedError = JSON.stringify({
      _tag: "TokenAlreadySpent",
      mint: "https://mint.example",
    });

    await Effect.runPromise(
      store.insert(
        newRow({ error: taggedError, state: "error", tokenText: "cashuAerr" }),
      ),
    );

    const rows = await loadAll(store);
    expect(rows[0].error).toBe(taggedError);
  });

  it("reads null and unknown legacy states as accepted", async () => {
    const { seed, store } = makeFakeCashuTable();
    seed(createCashuTokenRowFixture({ state: null, token: "cashuAnullState" }));
    seed(
      createCashuTokenRowFixture({
        state: "spent??",
        token: "cashuAweirdState",
      }),
    );

    const rows = await loadAll(store);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.state === "accepted")).toBe(true);
  });

  it("falls back to rawToken then token for legacy originalTokenText", async () => {
    const { seed, store } = makeFakeCashuTable();
    seed(
      createCashuTokenRowFixture({
        rawToken: "cashuArawLegacy",
        token: "cashuAswappedLegacy",
      }),
    );
    seed(createCashuTokenRowFixture({ token: "cashuAtokenOnly" }));

    const rows = await loadAll(store);
    const withRaw = rows.find((row) => row.tokenText === "cashuAswappedLegacy");
    const withoutRaw = rows.find((row) => row.tokenText === "cashuAtokenOnly");
    expect(withRaw?.originalTokenText).toBe("cashuArawLegacy");
    expect(withoutRaw?.originalTokenText).toBe("cashuAtokenOnly");
  });

  it("wraps legacy plain-text errors as a tagged LegacyError", async () => {
    const { seed, store } = makeFakeCashuTable();
    seed(
      createCashuTokenRowFixture({
        error: "Token already spent",
        state: "error",
        token: "cashuAlegacyError",
      }),
    );

    const rows = await loadAll(store);
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].error ?? "")).toEqual({
      _tag: "LegacyError",
      detail: "Token already spent",
    });
  });

  it("reads stale error text on non-error rows as null", async () => {
    const { seed, store } = makeFakeCashuTable();
    seed(
      createCashuTokenRowFixture({
        error: "stale failure",
        state: "accepted",
        token: "cashuAstaleError",
      }),
    );

    const rows = await loadAll(store);
    expect(rows[0].error).toBeNull();
  });

  it("skips legacy error rows whose token text is not a cashu token", async () => {
    const { seed, store } = makeFakeCashuTable();
    seed(
      createCashuTokenRowFixture({
        error: "Accept failed",
        state: "error",
        token: "not a cashu token",
      }),
    );

    expect(await loadAll(store)).toHaveLength(0);
  });

  it("applies patches and clears errors through update", async () => {
    const { store } = makeFakeCashuTable();
    const inserted = await Effect.runPromise(
      store.insert(
        newRow({
          error: JSON.stringify({ _tag: "MintUnreachable" }),
          state: "error",
          tokenText: "cashuAtoPatch",
        }),
      ),
    );

    await Effect.runPromise(
      store.update(inserted.id, {
        error: null,
        state: "accepted",
        tokenText: TokenText.make("cashuAafterSwap"),
      }),
    );

    const rows = await loadAll(store);
    expect(rows[0]).toMatchObject({
      error: null,
      state: "accepted",
      tokenText: "cashuAafterSwap",
    });
  });

  it("never returns removed rows from loadAll", async () => {
    const { store } = makeFakeCashuTable();
    const inserted = await Effect.runPromise(
      store.insert(newRow({ tokenText: "cashuAtoRemove" })),
    );

    await Effect.runPromise(store.remove(inserted.id));
    expect(await loadAll(store)).toHaveLength(0);

    // Removing again is a no-op, and the row stays gone.
    await Effect.runPromise(store.remove(inserted.id));
    expect(await loadAll(store)).toHaveLength(0);
  });

  it("hides rows already soft-deleted in Evolu", async () => {
    const { seed, store } = makeFakeCashuTable();
    seed(
      createCashuTokenRowFixture({ isDeleted: true, token: "cashuAdeleted" }),
    );

    expect(await loadAll(store)).toHaveLength(0);
  });

  describe("write overlay over a lagging read model", () => {
    it("updates a just-inserted row before the read model shows it", async () => {
      const { store, sync } = makeFakeCashuTable({ lagging: true });
      const inserted = await Effect.runPromise(
        store.insert(newRow({ state: "pending", tokenText: "cashuAfresh" })),
      );

      await Effect.runPromise(
        store.update(inserted.id, {
          state: "accepted",
          tokenText: TokenText.make("cashuAswapped"),
        }),
      );

      const beforeSync = await loadAll(store);
      expect(beforeSync).toHaveLength(1);
      expect(beforeSync[0]).toMatchObject({
        state: "accepted",
        tokenText: "cashuAswapped",
      });

      sync();
      const afterSync = await loadAll(store);
      expect(afterSync).toHaveLength(1);
      expect(afterSync[0]).toMatchObject({
        state: "accepted",
        tokenText: "cashuAswapped",
      });
    });

    it("keeps serving the overlay row until the read model reflects it", async () => {
      const { store, sync } = makeFakeCashuTable({ lagging: true });
      const inserted = await Effect.runPromise(
        store.insert(newRow({ state: "pending", tokenText: "cashuAlagging" })),
      );
      sync();

      await Effect.runPromise(store.update(inserted.id, { state: "accepted" }));

      // Snapshot still shows the pending write; the overlay must win.
      const stale = await loadAll(store);
      expect(stale[0].state).toBe("accepted");

      sync();
      expect((await loadAll(store))[0].state).toBe("accepted");
    });

    it("hides a removed row the read model still contains", async () => {
      const { store, sync } = makeFakeCashuTable({ lagging: true });
      const inserted = await Effect.runPromise(
        store.insert(newRow({ tokenText: "cashuAremoveLag" })),
      );
      sync();

      await Effect.runPromise(store.remove(inserted.id));
      expect(await loadAll(store)).toHaveLength(0);

      sync();
      expect(await loadAll(store)).toHaveLength(0);
    });

    it("dedups against a row inserted but not yet visible", async () => {
      const { store } = makeFakeCashuTable({ lagging: true });
      await Effect.runPromise(
        store.insert(newRow({ tokenText: "cashuAinvisible" })),
      );

      const rows = await loadAll(store);
      expect(rows.map((row) => row.tokenText)).toEqual(["cashuAinvisible"]);
    });

    it("serves updates of already-visible rows before the read model catches up", async () => {
      const { store, sync } = makeFakeCashuTable({ lagging: true });
      const inserted = await Effect.runPromise(
        store.insert(newRow({ state: "accepted", tokenText: "cashuAcatchUp" })),
      );
      sync();
      await loadAll(store);

      await Effect.runPromise(store.update(inserted.id, { state: "issued" }));
      expect((await loadAll(store))[0].state).toBe("issued");

      sync();
      expect((await loadAll(store))[0].state).toBe("issued");
    });
  });

  it("targets the row's stored owner lane, not the active write lane", async () => {
    const { seed, store } = makeFakeCashuTable();
    seed(
      createCashuTokenRowFixture({
        ownerId: oldOwnerId,
        state: "accepted",
        token: "cashuAoldLane",
      }),
    );

    const rows = await loadAll(store);
    await Effect.runPromise(store.update(rows[0].id, { state: "reserved" }));
    const patched = await loadAll(store);
    expect(patched[0].state).toBe("reserved");

    await Effect.runPromise(store.remove(rows[0].id));
    expect(await loadAll(store)).toHaveLength(0);
  });
});
