import type { Proof as CashuProof } from "@cashu/cashu-ts";
import { getEncodedToken, MintOperationError } from "@cashu/cashu-ts";
import { Effect, Either, Exit, Layer, Schema } from "effect";
import { MintRejected, TokenAlreadySpent } from "../domain/errors";
import {
  MintUrl,
  TokenRowId,
  TokenText,
  UnixSeconds,
} from "../domain/primitives";
import { WalletInstances } from "../mint/internal/WalletInstances";
import { deterministicIdTokenStore } from "../testing/deterministicIdTokenStore";
import { inMemoryKeyValueStore } from "../ports/inMemoryKeyValueStore";
import {
  inMemoryTokenStore,
  makeInMemoryTokenStore,
} from "../ports/inMemoryTokenStore";
import { NewTokenRow, StoredTokenRow, TokenStore } from "../ports/TokenStore";
import { fakeWallet, KEYSET_HEX, proof } from "../testing/fakeWallet";
import { recordingInspector } from "../testing/inspector";
import { amountOf, seedRow as seedTokenRow } from "../testing/rows";
import type { TokenState } from "./domain";
import { Tokens } from "./Tokens";

const mint = MintUrl.make("https://mint.example");

const tokenOf = (...proofs: ReadonlyArray<CashuProof>): TokenText =>
  TokenText.make(getEncodedToken({ mint, unit: "sat", proofs: [...proofs] }));

const tokenA = tokenOf(proof(4, "sec-a1"), proof(2, "sec-a2"));
const tokenB = tokenOf(proof(8, "sec-b1"));
const tokenC = tokenOf(proof(16, "sec-c1"));
/** What the mint hands back when a token is re-received (its input fee taken). */
const swappedProofs = [proof(4, "fresh-1"), proof(1, "fresh-2")];

const encodeSpent = Schema.encodeSync(Schema.parseJson(TokenAlreadySpent));
const encodeRejected = Schema.encodeSync(Schema.parseJson(MintRejected));

const ALL_STATES: ReadonlyArray<TokenState> = [
  "pending",
  "accepted",
  "reserved",
  "issued",
  "externalized",
  "error",
];

type StateName = "UNSPENT" | "PENDING" | "SPENT";

interface HarnessArgs {
  receive?: () => Promise<CashuProof[]>;
  stateOf?: (secret: string) => StateName;
  checkStatesError?: unknown;
  /** Answer fewer states than asked, to emulate a truncated response. */
  truncateTo?: number;
  tokenStore?: Layer.Layer<TokenStore>;
}

const makeHarness = (args: HarnessArgs = {}) => {
  const inspector = recordingInspector();
  const checkedSecrets: string[][] = [];
  let receiveCalls = 0;
  const wallet = fakeWallet({
    keysetId: KEYSET_HEX,
    receive: () => {
      receiveCalls += 1;
      return args.receive?.() ?? Promise.reject(new Error("not under test"));
    },
    checkProofsStates: (proofs) => {
      checkedSecrets.push(proofs.map((entry) => entry.secret ?? ""));
      return args.checkStatesError !== undefined
        ? Promise.reject(args.checkStatesError)
        : Promise.resolve(
            proofs.slice(0, args.truncateTo ?? proofs.length).map((entry) => ({
              Y: entry.secret ?? "",
              state: args.stateOf?.(entry.secret ?? "") ?? "UNSPENT",
              witness: null,
            })),
          );
    },
  });

  const layer = Tokens.DefaultWithoutDependencies.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.succeed(
          WalletInstances,
          WalletInstances.make({ get: () => Effect.succeed(wallet) }),
        ),
        inMemoryKeyValueStore,
        args.tokenStore ?? inMemoryTokenStore,
        inspector.layer,
      ),
    ),
  );

  const run = <A, E>(program: Effect.Effect<A, E, Tokens | TokenStore>) =>
    Effect.runPromiseExit(program.pipe(Effect.provide(layer)));

  return {
    run,
    events: inspector.events,
    checkedSecrets,
    receiveCalls: () => receiveCalls,
  };
};

interface Seed {
  readonly tokenText: TokenText;
  readonly state: TokenState;
  readonly error?: string;
}

const seedRow = (seed: Seed) =>
  seedTokenRow(seed.tokenText, seed.state, seed.error ?? null);

/** Seeds rows, runs one Tokens call, and reports the resulting store. */
const withRows = <A, E>(
  seeds: ReadonlyArray<Seed>,
  operation: (tokens: Tokens) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const rowIds = yield* Effect.forEach(seeds, (seed) =>
      Effect.map(seedRow(seed), (row) => row.id),
    );
    const result = yield* Effect.either(operation(yield* Tokens));
    return { rowIds, result, rows: yield* (yield* TokenStore).loadAll };
  });

describe("Tokens.list", () => {
  const storedRow = (
    id: string,
    tokenText: string,
    createdAt: number,
    state: TokenState = "accepted",
  ): StoredTokenRow =>
    new StoredTokenRow({
      id: TokenRowId.make(id),
      originalTokenText: TokenText.make(tokenText),
      tokenText: TokenText.make(tokenText),
      state,
      error: null,
      createdAt: UnixSeconds.make(createdAt),
    });

  const listOf = (rows: ReadonlyArray<StoredTokenRow>) =>
    Effect.runPromise(
      Effect.flatMap(Tokens, (tokens) => tokens.list).pipe(
        Effect.provide(
          Tokens.DefaultWithoutDependencies.pipe(
            Layer.provideMerge(
              Layer.mergeAll(
                Layer.succeed(
                  WalletInstances,
                  WalletInstances.make({
                    get: () => Effect.die("not under test"),
                  }),
                ),
                inMemoryKeyValueStore,
                Layer.succeed(TokenStore, {
                  ...makeInMemoryTokenStore(),
                  loadAll: Effect.succeed(rows),
                }),
              ),
            ),
          ),
        ),
      ),
    );

  it("enriches every row from its token text", async () => {
    const tokens = await listOf([
      storedRow("row-a", tokenA, 10),
      storedRow("row-b", tokenB, 20, "issued"),
    ]);

    expect(tokens.map((token) => token.id)).toEqual(["row-b", "row-a"]);
    expect(tokens[1]).toMatchObject({
      id: "row-a",
      state: "accepted",
      tokenText: tokenA,
      mint,
      unit: "sat",
      amount: 6,
      error: null,
      createdAt: 10,
    });
    expect(tokens[0]).toMatchObject({ state: "issued", amount: 8 });
  });

  it("orders newest first regardless of store order", async () => {
    const tokens = await listOf([
      storedRow("old", tokenA, 100),
      storedRow("newest", tokenB, 300),
      storedRow("middle", tokenC, 200),
    ]);

    expect(tokens.map((token) => token.id)).toEqual([
      "newest",
      "middle",
      "old",
    ]);
  });

  it("drops rows whose token text no longer parses", async () => {
    const tokens = await listOf([
      storedRow("broken", "cashuBnotatoken", 10),
      storedRow("good", tokenA, 20),
    ]);

    expect(tokens.map((token) => token.id)).toEqual(["good"]);
  });
});

const balancesOf = (rows: ReadonlyArray<Seed>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* Effect.forEach(rows, seedRow);
      return yield* (yield* Tokens).balances;
    }).pipe(
      Effect.provide(
        Tokens.DefaultWithoutDependencies.pipe(
          Layer.provideMerge(
            Layer.mergeAll(
              Layer.succeed(
                WalletInstances,
                WalletInstances.make({
                  get: () => Effect.die("not under test"),
                }),
              ),
              inMemoryKeyValueStore,
              inMemoryTokenStore,
            ),
          ),
        ),
      ),
    ),
  );

const mintToken = (mintUrl: string, amount: number, secret: string): Seed => ({
  tokenText: TokenText.make(
    getEncodedToken({
      mint: mintUrl,
      unit: "sat",
      proofs: [proof(amount, secret)],
    }),
  ),
  state: "accepted",
});

describe("Tokens.balances", () => {
  it("is empty for an empty wallet", async () => {
    const balances = await balancesOf([]);
    expect(balances.total).toBe(0);
    expect(balances.spendable).toBe(0);
    expect(balances.perMint).toEqual([]);
  });

  it("sums accepted rows per mint; spendable is the largest single mint", async () => {
    const balances = await balancesOf([
      mintToken("https://mint.one", 4, "a"),
      mintToken("https://mint.one", 2, "b"),
      mintToken("https://mint.two", 5, "c"),
    ]);

    expect(balances.total).toBe(11);
    expect(balances.spendable).toBe(6);
    expect(
      balances.perMint.map(({ mint: url, amount }) => [String(url), amount]),
    ).toEqual([
      ["https://mint.one", 6],
      ["https://mint.two", 5],
    ]);
  });

  it("counts only accepted rows", async () => {
    const balances = await balancesOf([
      mintToken("https://mint.one", 4, "a"),
      { ...mintToken("https://mint.one", 8, "b"), state: "pending" },
      { ...mintToken("https://mint.one", 16, "c"), state: "reserved" },
      { ...mintToken("https://mint.one", 32, "d"), state: "issued" },
      { ...mintToken("https://mint.one", 64, "e"), state: "externalized" },
      { ...mintToken("https://mint.one", 128, "f"), state: "error" },
    ]);

    expect(balances.total).toBe(4);
    expect(balances.spendable).toBe(4);
  });
});

/**
 * Each transition attempted from every state: the outcome is the state the
 * row ended in, or the tag of the failure that kept it where it was.
 */
const outcomesFromEveryState = (
  operation: (
    tokens: Tokens,
    rowId: TokenRowId,
  ) => Effect.Effect<void, { readonly _tag: string }>,
) =>
  Effect.forEach(ALL_STATES, (from) =>
    Effect.gen(function* () {
      const store = yield* TokenStore;
      const row = yield* store.insert(
        new NewTokenRow({
          originalTokenText: tokenA,
          tokenText: tokenA,
          state: from,
          error:
            from === "error"
              ? encodeSpent(new TokenAlreadySpent({ mint }))
              : null,
        }),
      );
      const result = yield* Effect.either(operation(yield* Tokens, row.id));
      const stored = (yield* store.loadAll).find(
        (candidate) => candidate.id === row.id,
      );
      return [
        from,
        Either.isRight(result) ? stored?.state : result.left._tag,
        stored?.error,
      ] as const;
    }),
  );

describe("Tokens lifecycle transitions", () => {
  it("reserves only accepted rows", async () => {
    const { run } = makeHarness();

    const exit = await run(
      outcomesFromEveryState((tokens, rowId) => tokens.reserve(rowId)),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.map(([from, outcome]) => [from, outcome])).toEqual([
      ["pending", "InvalidTokenTransition"],
      ["accepted", "reserved"],
      ["reserved", "InvalidTokenTransition"],
      ["issued", "InvalidTokenTransition"],
      ["externalized", "InvalidTokenTransition"],
      ["error", "InvalidTokenTransition"],
    ]);
  });

  it("issues accepted and reserved rows", async () => {
    const { run } = makeHarness();

    const exit = await run(
      outcomesFromEveryState((tokens, rowId) => tokens.markIssued(rowId)),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.map(([from, outcome]) => [from, outcome])).toEqual([
      ["pending", "InvalidTokenTransition"],
      ["accepted", "issued"],
      ["reserved", "issued"],
      ["issued", "InvalidTokenTransition"],
      ["externalized", "InvalidTokenTransition"],
      ["error", "InvalidTokenTransition"],
    ]);
  });

  it("externalizes accepted, reserved, and issued rows", async () => {
    const { run } = makeHarness();

    const exit = await run(
      outcomesFromEveryState((tokens, rowId) => tokens.markExternalized(rowId)),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.map(([from, outcome]) => [from, outcome])).toEqual([
      ["pending", "InvalidTokenTransition"],
      ["accepted", "externalized"],
      ["reserved", "externalized"],
      ["issued", "externalized"],
      ["externalized", "InvalidTokenTransition"],
      ["error", "InvalidTokenTransition"],
    ]);
  });

  it("clears the error a row carried and reports the move", async () => {
    const { run, events } = makeHarness();

    const exit = await run(
      Effect.gen(function* () {
        const store = yield* TokenStore;
        const row = yield* store.insert(
          new NewTokenRow({
            originalTokenText: tokenA,
            tokenText: tokenA,
            state: "accepted",
            error: encodeRejected(
              new MintRejected({ mint, code: 20003, detail: "stale" }),
            ),
          }),
        );
        yield* (yield* Tokens).reserve(row.id);
        return (yield* store.loadAll)[0];
      }),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value?.state).toBe("reserved");
    expect(exit.value?.error).toBeNull();
    expect(events.map((event) => event._tag)).toEqual([
      "TokenLifecycleChanged",
      "OperationSucceeded",
    ]);
    expect(events[1]).toMatchObject({
      name: "tokens.reserve",
      params: { rowId: exit.value?.id },
    });
  });

  it("fails with TokenRowNotFound for an unknown row", async () => {
    const { run } = makeHarness();

    const exit = await run(
      Effect.flatMap(Tokens, (tokens) =>
        Effect.flip(tokens.markIssued(TokenRowId.make("missing"))),
      ),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value).toMatchObject({ _tag: "TokenRowNotFound" });
  });
});

/** Seeds one row, runs a Tokens call against it, and reports the store. */
const onSeededRow = <A, E>(
  seed: Seed,
  operation: (tokens: Tokens, rowId: TokenRowId) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const row = yield* seedRow(seed);
    const result = yield* Effect.either(operation(yield* Tokens, row.id));
    return { row, result, rows: yield* (yield* TokenStore).loadAll };
  });

const returnRow = (seed: Seed) =>
  onSeededRow(seed, (tokens, rowId) => tokens.returnToWallet(rowId));

interface StoreCase {
  readonly name: string;
  readonly tokenStore: Layer.Layer<TokenStore>;
  /** The Evolu adapter derives ids from `originalTokenText`, so a re-receive lands on the replaced row's own id. */
  readonly reusesRowId: boolean;
}

const storeCases: ReadonlyArray<StoreCase> = [
  {
    name: "a unique-id store",
    tokenStore: inMemoryTokenStore,
    reusesRowId: false,
  },
  {
    name: "a deterministic-id store",
    tokenStore: deterministicIdTokenStore,
    reusesRowId: true,
  },
];

describe.each(storeCases)(
  "Tokens.returnToWallet with $name",
  ({ tokenStore, reusesRowId }) => {
    const harness = (args: HarnessArgs = {}) =>
      makeHarness({ ...args, tokenStore });

    it("drops a reservation locally, without contacting the mint", async () => {
      const { run, receiveCalls } = harness();

      const exit = await run(
        returnRow({ tokenText: tokenA, state: "reserved" }),
      );

      assert(Exit.isSuccess(exit));
      const { row, result, rows } = exit.value;
      expect(receiveCalls()).toBe(0);
      assert(result._tag === "Right");
      expect(result.right).toMatchObject({
        rowId: row.id,
        tokenText: tokenA,
        mint,
        unit: "sat",
        amount: 6,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: row.id, state: "accepted" });
    });

    it("keeps a reservation whose token text no longer parses", async () => {
      const { run, receiveCalls } = harness();

      const exit = await run(
        returnRow({
          tokenText: TokenText.make("cashuBnotatoken"),
          state: "reserved",
        }),
      );

      assert(Exit.isSuccess(exit));
      const { row, result, rows } = exit.value;
      expect(receiveCalls()).toBe(0);
      assert(result._tag === "Left");
      expect(result.left._tag).toBe("TokenParseFailed");
      // The parse runs before the flip: the row must still be reserved.
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: row.id, state: "reserved" });
    });

    it("re-receives an issued row and drops the handed-out encoding", async () => {
      const { run, events } = harness({
        receive: () => Promise.resolve(swappedProofs),
      });

      const exit = await run(returnRow({ tokenText: tokenA, state: "issued" }));

      assert(Exit.isSuccess(exit));
      const { row, result, rows } = exit.value;
      assert(result._tag === "Right");
      expect(result.right.amount).toBe(5);
      expect(result.right.rowId === row.id).toBe(reusesRowId);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: result.right.rowId,
        state: "accepted",
        tokenText: result.right.tokenText,
        error: null,
      });
      expect(rows[0]?.tokenText).not.toBe(tokenA);
      // The replaced row only goes away once the fresh proofs are stored.
      expect(
        events
          .filter((event) => event._tag === "TokenLifecycleChanged")
          .map((event) => [event.from, event.to]),
      ).toEqual([
        [null, "pending"],
        ["pending", "accepted"],
      ]);

      const serialized = JSON.stringify(events);
      expect(serialized).not.toContain("cashu");
      expect(serialized).not.toContain("fresh-1");
    });

    it("re-receives an errored row", async () => {
      const { run } = harness({
        receive: () => Promise.resolve(swappedProofs),
      });

      const exit = await run(
        returnRow({
          tokenText: tokenA,
          state: "error",
          error: encodeRejected(
            new MintRejected({ mint, code: 20003, detail: "keyset inactive" }),
          ),
        }),
      );

      assert(Exit.isSuccess(exit));
      expect(exit.value.result._tag).toBe("Right");
      expect(exit.value.rows).toHaveLength(1);
      expect(exit.value.rows[0]).toMatchObject({
        state: "accepted",
        error: null,
      });
    });

    it("rejects an accepted row: there is nothing to bring back", async () => {
      const { run, receiveCalls } = harness();

      const exit = await run(
        returnRow({ tokenText: tokenA, state: "accepted" }),
      );

      assert(Exit.isSuccess(exit));
      assert(exit.value.result._tag === "Left");
      expect(exit.value.result.left).toMatchObject({
        _tag: "InvalidTokenTransition",
        from: "accepted",
        to: "accepted",
      });
      expect(receiveCalls()).toBe(0);
      expect(exit.value.rows[0]?.state).toBe("accepted");
    });

    it("marks the returned row spent when the mint says it is gone", async () => {
      const { run } = harness({
        receive: () =>
          Promise.reject(new MintOperationError(11001, "Token already spent.")),
      });

      const exit = await run(returnRow({ tokenText: tokenA, state: "issued" }));

      assert(Exit.isSuccess(exit));
      const { row, result, rows } = exit.value;
      assert(result._tag === "Left");
      expect(result.left).toMatchObject({ _tag: "TokenAlreadySpent", mint });

      // Only the row the caller knows about survives, carrying the failure.
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: row.id,
        state: "error",
        tokenText: tokenA,
      });
      expect(JSON.parse(rows[0]?.error ?? "")).toMatchObject({
        _tag: "TokenAlreadySpent",
      });
    });

    it("leaves the issued row untouched when the mint is unreachable", async () => {
      const { run } = harness({
        receive: () => Promise.reject(new TypeError("fetch failed")),
      });

      const exit = await run(returnRow({ tokenText: tokenA, state: "issued" }));

      assert(Exit.isSuccess(exit));
      const { row, result, rows } = exit.value;
      assert(result._tag === "Left");
      expect(result.left._tag).toBe("MintUnreachable");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: row.id,
        state: "issued",
        tokenText: tokenA,
        error: null,
      });
    });

    it("restores an errored row's recorded error on a transient failure", async () => {
      const recorded = encodeRejected(
        new MintRejected({ mint, code: 20003, detail: "keyset inactive" }),
      );
      const { run } = harness({
        receive: () => Promise.reject(new TypeError("fetch failed")),
      });

      const exit = await run(
        returnRow({ tokenText: tokenA, state: "error", error: recorded }),
      );

      assert(Exit.isSuccess(exit));
      const { row, result, rows } = exit.value;
      assert(result._tag === "Left");
      expect(result.left._tag).toBe("MintUnreachable");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: row.id,
        state: "error",
        tokenText: tokenA,
        error: recorded,
      });
    });

    it("keeps an externalized row in its state on a definitive failure", async () => {
      const { run } = harness({
        receive: () =>
          Promise.reject(new MintOperationError(11001, "Token already spent.")),
      });

      const exit = await run(
        returnRow({ tokenText: tokenA, state: "externalized" }),
      );

      assert(Exit.isSuccess(exit));
      const { row, result, rows } = exit.value;
      expect(result._tag).toBe("Left");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: row.id,
        state: "externalized",
        tokenText: tokenA,
        error: null,
      });
    });

    it("fails with TokenRowNotFound for an unknown row", async () => {
      const { run } = harness();

      const exit = await run(
        Effect.flatMap(Tokens, (tokens) =>
          Effect.flip(tokens.returnToWallet(TokenRowId.make("missing"))),
        ),
      );

      assert(Exit.isSuccess(exit));
      expect(exit.value).toMatchObject({ _tag: "TokenRowNotFound" });
    });
  },
);

const deleteSpentOn = (seeds: ReadonlyArray<Seed>) =>
  withRows(seeds, (tokens) => tokens.deleteSpent);

describe("Tokens.deleteSpent", () => {
  it("deletes rows the mint reports fully spent and keeps the rest", async () => {
    const { run, events } = makeHarness({
      stateOf: (secret) => (secret.startsWith("sec-a") ? "SPENT" : "UNSPENT"),
    });

    const exit = await run(
      deleteSpentOn([
        { tokenText: tokenA, state: "accepted" },
        { tokenText: tokenB, state: "accepted" },
      ]),
    );

    assert(Exit.isSuccess(exit));
    const { rowIds, result, rows } = exit.value;
    assert(result._tag === "Right");
    expect(result.right).toHaveLength(1);
    expect(result.right[0]).toMatchObject({ rowId: rowIds[0], amount: 6 });
    expect(rows.map((row) => row.tokenText)).toEqual([tokenB]);
    expect(events.at(-1)).toMatchObject({ name: "tokens.deleteSpent" });
  });

  it("keeps a partially spent row", async () => {
    const { run } = makeHarness({
      stateOf: (secret) => (secret === "sec-a1" ? "SPENT" : "UNSPENT"),
    });

    const exit = await run(
      deleteSpentOn([{ tokenText: tokenA, state: "accepted" }]),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.result).toMatchObject({ right: [] });
    expect(amountOf(exit.value.rows[0])).toBe(6);
  });

  it("re-confirms a row already marked spent instead of trusting the marker", async () => {
    // Receive records TokenAlreadySpent when a swap is rejected over a
    // partially spent token — the mint must vouch again before deletion.
    const { run } = makeHarness({
      stateOf: (secret) => (secret === "sec-a1" ? "SPENT" : "UNSPENT"),
    });
    const markedSpent = encodeSpent(new TokenAlreadySpent({ mint }));

    const exit = await run(
      deleteSpentOn([
        { tokenText: tokenA, state: "error", error: markedSpent },
      ]),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.result).toMatchObject({ right: [] });
    expect(exit.value.rows).toHaveLength(1);
  });

  it("deletes a marked-spent row once the mint confirms every proof", async () => {
    const { run } = makeHarness({ stateOf: () => "SPENT" });

    const exit = await run(
      deleteSpentOn([
        {
          tokenText: tokenA,
          state: "error",
          error: encodeSpent(new TokenAlreadySpent({ mint })),
        },
      ]),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.result).toMatchObject({
      right: [{ rowId: exit.value.rowIds[0], amount: 6 }],
    });
    expect(exit.value.rows).toEqual([]);
  });

  it("keeps a marked-spent row while the mint is unreachable", async () => {
    const { run } = makeHarness({
      checkStatesError: new TypeError("fetch failed"),
    });

    const exit = await run(
      deleteSpentOn([
        {
          tokenText: tokenA,
          state: "error",
          error: encodeSpent(new TokenAlreadySpent({ mint })),
        },
      ]),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.result).toMatchObject({ right: [] });
    expect(exit.value.rows).toHaveLength(1);
  });

  it("re-checks error rows whose failure was not a spend", async () => {
    const { run } = makeHarness({
      stateOf: (secret) => (secret === "sec-b1" ? "SPENT" : "UNSPENT"),
    });
    const rejected = encodeRejected(
      new MintRejected({ mint, code: 20003, detail: "keyset inactive" }),
    );

    const exit = await run(
      deleteSpentOn([
        { tokenText: tokenA, state: "error", error: rejected },
        { tokenText: tokenB, state: "error", error: rejected },
      ]),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.result).toMatchObject({
      right: [{ rowId: exit.value.rowIds[1], amount: 8 }],
    });
    expect(exit.value.rows.map((row) => row.tokenText)).toEqual([tokenA]);
  });

  it("keeps every row when the mint cannot be asked", async () => {
    const { run } = makeHarness({
      checkStatesError: new TypeError("fetch failed"),
    });

    const exit = await run(
      deleteSpentOn([{ tokenText: tokenA, state: "accepted" }]),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.result).toMatchObject({ right: [] });
    expect(exit.value.rows).toHaveLength(1);
  });

  it("keeps rows the mint answered only partially", async () => {
    const { run } = makeHarness({ stateOf: () => "SPENT", truncateTo: 1 });

    const exit = await run(
      deleteSpentOn([
        { tokenText: tokenA, state: "accepted" },
        { tokenText: tokenB, state: "accepted" },
      ]),
    );

    assert(Exit.isSuccess(exit));
    // Only the first of the three proofs was answered: no row is covered.
    expect(exit.value.result).toMatchObject({ right: [] });
    expect(exit.value.rows).toHaveLength(2);
  });

  it("never touches rows whose funds are out with someone else", async () => {
    const { run, checkedSecrets } = makeHarness({ stateOf: () => "SPENT" });

    const exit = await run(
      deleteSpentOn([
        { tokenText: tokenA, state: "issued" },
        { tokenText: tokenB, state: "externalized" },
        { tokenText: tokenC, state: "pending" },
        { tokenText: tokenOf(proof(32, "sec-d1")), state: "reserved" },
      ]),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.result).toMatchObject({ right: [] });
    expect(exit.value.rows).toHaveLength(4);
    expect(checkedSecrets).toEqual([]);
  });
});
