import type { Proof as CashuProof } from "@cashu/cashu-ts";
import { getEncodedToken, MintOperationError } from "@cashu/cashu-ts";
import { Effect, Either, Exit, Layer, Schema } from "effect";
import { MintRejected, TokenAlreadySpent } from "../domain/errors";
import {
  Amount,
  Bolt11Invoice,
  CurrencyUnit,
  KeysetId,
  MintUrl,
  NonNegativeAmount,
  OperationId,
  QuoteId,
  TokenText,
  UnixSeconds,
} from "../domain/primitives";
import { WalletInstances } from "../mint/internal/WalletInstances";
import { inMemoryKeyValueStore } from "../ports/inMemoryKeyValueStore";
import { inMemoryOperationStore } from "../ports/inMemoryOperationStore";
import { inMemoryProofStore } from "../ports/inMemoryProofStore";
import { NewOperation, OperationStore } from "../ports/OperationStore";
import type { OperationStatus, StoredOperation } from "../ports/OperationStore";
import { ProofStore } from "../ports/ProofStore";
import type { ProofState, StoredProof } from "../ports/ProofStore";
import { fakeWallet, KEYSET_HEX, proof } from "../testing/fakeWallet";
import { recordingInspector } from "../testing/inspector";
import {
  amountIn,
  proofsIn,
  secretsOf,
  seedProofs,
  seedTransfer,
} from "../testing/inventory";
import { ImportProofDraft, LegacyTokenRow } from "./domain";
import { Tokens } from "./Tokens";

const mint = MintUrl.make("https://mint.example");
const sat = CurrencyUnit.make("sat");

const tokenOf = (...proofs: ReadonlyArray<CashuProof>): TokenText =>
  TokenText.make(getEncodedToken({ mint, unit: "sat", proofs: [...proofs] }));

const proofsA = [proof(4, "sec-a1"), proof(2, "sec-a2")];
const tokenA = tokenOf(...proofsA);
const tokenB = tokenOf(proof(8, "sec-b1"));
/** What the mint hands back when a token is re-received (its input fee taken). */
const swappedProofs = [proof(4, "fresh-1"), proof(1, "fresh-2")];

const encodeSpent = Schema.encodeSync(Schema.parseJson(TokenAlreadySpent));
const encodeRejected = Schema.encodeSync(Schema.parseJson(MintRejected));
const rejected = encodeRejected(
  new MintRejected({ mint, code: 20003, detail: "keyset inactive" }),
);

interface HarnessArgs {
  receive?: () => Promise<CashuProof[]>;
}

const makeHarness = (args: HarnessArgs = {}) => {
  const inspector = recordingInspector();
  let receiveCalls = 0;
  const wallet = fakeWallet({
    keysetId: KEYSET_HEX,
    receive: () => {
      receiveCalls += 1;
      return args.receive?.() ?? Promise.reject(new Error("not under test"));
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
        inMemoryProofStore,
        inMemoryOperationStore,
        inspector.layer,
      ),
    ),
  );

  const run = <A, E>(
    program: Effect.Effect<A, E, Tokens | ProofStore | OperationStore>,
  ) => Effect.runPromiseExit(program.pipe(Effect.provide(layer)));

  return { run, events: inspector.events, receiveCalls: () => receiveCalls };
};

const inventory = Effect.gen(function* () {
  return {
    proofs: yield* (yield* ProofStore).loadAll,
    operations: yield* (yield* OperationStore).loadAll,
  };
});

const stateOf = (
  proofs: ReadonlyArray<StoredProof>,
  secret: string,
): ProofState | undefined => proofs.find((p) => p.secret === secret)?.state;

const operationById = (
  operations: ReadonlyArray<StoredOperation>,
  id: OperationId,
): StoredOperation | undefined => operations.find((op) => op.id === id);

/** A quote-kind operation; transfers come from `seedTransfer`. */
const quoteOperation = (
  overrides: Partial<ConstructorParameters<typeof NewOperation>[0]>,
): NewOperation =>
  new NewOperation({
    kind: "melt",
    status: "pending",
    mint,
    unit: sat,
    keysetId: KeysetId.make(KEYSET_HEX),
    amount: Amount.make(5),
    feeReserve: NonNegativeAmount.make(1),
    inputsTotal: Amount.make(6),
    quoteId: QuoteId.make("quote-1"),
    invoice: Bolt11Invoice.make("lnbc50n1test"),
    sourceMint: null,
    counter: null,
    locked: null,
    expiresAt: null,
    createdAt: UnixSeconds.make(1_700_000_000),
    tokenText: null,
    error: null,
    ...overrides,
  });

const seedOperation = (operation: NewOperation) =>
  Effect.flatMap(OperationStore, (store) => store.insert(operation));

describe("Tokens read models", () => {
  it("lists every proof whatever its state", async () => {
    const { run } = makeHarness();

    const exit = await run(
      Effect.gen(function* () {
        yield* seedProofs(mint, [proof(4, "a")], "available");
        yield* seedProofs(mint, [proof(2, "b")], "spent");
        yield* seedProofs(mint, [proof(1, "c")], "handedOut");
        return yield* (yield* Tokens).proofs;
      }),
    );

    assert(Exit.isSuccess(exit));
    expect(secretsOf(exit.value)).toEqual(["a", "b", "c"]);
  });

  it("lists operations newest first and transfers without quote operations", async () => {
    const { run } = makeHarness();

    const exit = await run(
      Effect.gen(function* () {
        yield* seedOperation(
          quoteOperation({ createdAt: UnixSeconds.make(300) }),
        );
        const receive = yield* seedOperation(
          new NewOperation({
            ...quoteOperation({ createdAt: UnixSeconds.make(100) }),
            kind: "receive",
            status: "done",
            keysetId: null,
            feeReserve: null,
            inputsTotal: null,
            quoteId: null,
            invoice: null,
            amount: Amount.make(6),
            tokenText: tokenA,
          }),
        );
        const send = yield* seedOperation(
          new NewOperation({
            ...quoteOperation({ createdAt: UnixSeconds.make(200) }),
            kind: "send",
            status: "issued",
            keysetId: null,
            feeReserve: null,
            inputsTotal: null,
            quoteId: null,
            invoice: null,
            amount: Amount.make(8),
            tokenText: tokenB,
            error: rejected,
          }),
        );
        const tokens = yield* Tokens;
        return {
          receive,
          send,
          operations: yield* tokens.operations,
          transfers: yield* tokens.transfers,
        };
      }),
    );

    assert(Exit.isSuccess(exit));
    const { receive, send, operations, transfers } = exit.value;
    expect(operations.map((op) => op.createdAt)).toEqual([300, 200, 100]);
    expect(transfers.map((transfer) => transfer.id)).toEqual([
      send.id,
      receive.id,
    ]);
    expect(transfers[0]).toMatchObject({
      kind: "send",
      status: "issued",
      tokenText: tokenB,
      mint,
      unit: "sat",
      amount: 8,
      error: rejected,
      createdAt: 200,
    });
    expect(transfers[1]).toMatchObject({
      kind: "receive",
      status: "done",
      amount: 6,
      error: null,
    });
  });
});

const balancesOf = (
  seeds: ReadonlyArray<{
    readonly mint: string;
    readonly proof: CashuProof;
    readonly state?: ProofState;
  }>,
) =>
  makeHarness().run(
    Effect.gen(function* () {
      yield* Effect.forEach(seeds, (seed) =>
        seedProofs(seed.mint, [seed.proof], seed.state),
      );
      return yield* (yield* Tokens).balances;
    }),
  );

describe("Tokens.balances", () => {
  it("is empty for an empty wallet", async () => {
    const exit = await balancesOf([]);
    assert(Exit.isSuccess(exit));
    expect(exit.value.total).toBe(0);
    expect(exit.value.spendable).toBe(0);
    expect(exit.value.perMint).toEqual([]);
  });

  it("sums available proofs per mint; spendable is the largest single mint", async () => {
    const exit = await balancesOf([
      { mint: "https://mint.one", proof: proof(4, "a") },
      { mint: "https://mint.one", proof: proof(2, "b") },
      { mint: "https://mint.two", proof: proof(5, "c") },
    ]);

    assert(Exit.isSuccess(exit));
    expect(exit.value.total).toBe(11);
    expect(exit.value.spendable).toBe(6);
    expect(
      exit.value.perMint.map(({ mint: url, amount }) => [String(url), amount]),
    ).toEqual([
      ["https://mint.one", 6],
      ["https://mint.two", 5],
    ]);
  });

  it("counts only available proofs", async () => {
    const exit = await balancesOf([
      { mint, proof: proof(4, "a"), state: "available" },
      { mint, proof: proof(8, "b"), state: "held" },
      { mint, proof: proof(16, "c"), state: "handedOut" },
      { mint, proof: proof(32, "d"), state: "externalized" },
      { mint, proof: proof(64, "e"), state: "spent" },
    ]);

    assert(Exit.isSuccess(exit));
    expect(exit.value.total).toBe(4);
    expect(exit.value.spendable).toBe(4);
  });
});

const SEND_STATUSES: ReadonlyArray<OperationStatus> = [
  "issued",
  "pending",
  "externalized",
  "done",
  "returned",
];

const handedOutStateFor = (status: OperationStatus): ProofState =>
  status === "externalized"
    ? "externalized"
    : status === "done" || status === "returned"
      ? "spent"
      : "handedOut";

/**
 * One transition attempted from every send status, each over its own
 * transfer with one handed-out proof: the outcome is the status the
 * transfer ended in (with its proof's state), or the failure tag.
 */
const outcomesFromEverySendStatus = (
  operation: (
    tokens: Tokens,
    operationId: OperationId,
  ) => Effect.Effect<void, { readonly _tag: string }>,
) =>
  Effect.forEach(SEND_STATUSES, (from) =>
    Effect.gen(function* () {
      const secret = `sec-${from}`;
      const transfer = yield* seedTransfer(
        "send",
        from,
        mint,
        tokenOf(proof(2, secret)),
        2,
      );
      yield* seedProofs(
        mint,
        [proof(2, secret)],
        handedOutStateFor(from),
        transfer.id,
      );
      const result = yield* Effect.either(
        operation(yield* Tokens, transfer.id),
      );
      const { proofs, operations } = yield* inventory;
      return [
        from,
        Either.isRight(result)
          ? operationById(operations, transfer.id)?.status
          : result.left._tag,
        stateOf(proofs, secret),
      ] as const;
    }),
  );

describe("Tokens send transitions", () => {
  it("issues only pending sends", async () => {
    const { run } = makeHarness();

    const exit = await run(
      outcomesFromEverySendStatus((tokens, id) => tokens.markIssued(id)),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value).toEqual([
      ["issued", "InvalidTransferTransition", "handedOut"],
      ["pending", "issued", "handedOut"],
      ["externalized", "InvalidTransferTransition", "externalized"],
      ["done", "InvalidTransferTransition", "spent"],
      ["returned", "InvalidTransferTransition", "spent"],
    ]);
  });

  it("externalizes issued and pending sends along with their proofs", async () => {
    const { run } = makeHarness();

    const exit = await run(
      outcomesFromEverySendStatus((tokens, id) => tokens.markExternalized(id)),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value).toEqual([
      ["issued", "externalized", "externalized"],
      ["pending", "externalized", "externalized"],
      ["externalized", "InvalidTransferTransition", "externalized"],
      ["done", "InvalidTransferTransition", "spent"],
      ["returned", "InvalidTransferTransition", "spent"],
    ]);
  });

  it("forgets open sends without touching their handed-out proofs", async () => {
    const { run } = makeHarness();

    const exit = await run(
      outcomesFromEverySendStatus((tokens, id) => tokens.forget(id)),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value).toEqual([
      ["issued", "done", "handedOut"],
      ["pending", "done", "handedOut"],
      ["externalized", "done", "externalized"],
      ["done", "InvalidTransferTransition", "spent"],
      ["returned", "InvalidTransferTransition", "spent"],
    ]);
  });

  it("reports the transition and the proofs that followed it", async () => {
    const { run, events } = makeHarness();

    const exit = await run(
      Effect.gen(function* () {
        const transfer = yield* seedTransfer("send", "issued", mint, tokenA, 6);
        yield* seedProofs(mint, proofsA, "handedOut", transfer.id);
        yield* (yield* Tokens).markExternalized(transfer.id);
        return transfer.id;
      }),
    );

    assert(Exit.isSuccess(exit));
    expect(events).toEqual([
      expect.objectContaining({
        _tag: "ProofsChanged",
        from: "handedOut",
        to: "externalized",
        count: 2,
        amount: 6,
        operationId: exit.value,
        reason: "markExternalized",
      }),
      expect.objectContaining({
        _tag: "OperationChanged",
        operationId: exit.value,
        kind: "send",
        from: "issued",
        to: "externalized",
        reason: "markExternalized",
      }),
      expect.objectContaining({
        _tag: "OperationSucceeded",
        name: "tokens.markExternalized",
        params: { operationId: exit.value },
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain("cashu");
    expect(JSON.stringify(events)).not.toContain("sec-a1");
  });

  it("refuses send transitions on a receive", async () => {
    const { run } = makeHarness();

    const exit = await run(
      Effect.gen(function* () {
        const transfer = yield* seedTransfer(
          "receive",
          "done",
          mint,
          tokenA,
          6,
        );
        const tokens = yield* Tokens;
        return {
          issued: yield* Effect.flip(tokens.markIssued(transfer.id)),
          externalized: yield* Effect.flip(
            tokens.markExternalized(transfer.id),
          ),
        };
      }),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.issued).toMatchObject({
      _tag: "InvalidTransferTransition",
      from: "done",
      to: "issued",
    });
    expect(exit.value.externalized).toMatchObject({
      _tag: "InvalidTransferTransition",
      from: "done",
      to: "externalized",
    });
  });

  it("fails with OperationNotFound for an unknown or non-transfer operation", async () => {
    const { run } = makeHarness();

    const exit = await run(
      Effect.gen(function* () {
        const melt = yield* seedOperation(quoteOperation({}));
        const tokens = yield* Tokens;
        return {
          missing: yield* Effect.flip(
            tokens.markIssued(OperationId.make("missing")),
          ),
          melt: yield* Effect.flip(tokens.forget(melt.id)),
          returned: yield* Effect.flip(
            tokens.returnToWallet(OperationId.make("missing")),
          ),
        };
      }),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.missing).toMatchObject({
      _tag: "OperationNotFound",
      operationId: "missing",
    });
    expect(exit.value.melt._tag).toBe("OperationNotFound");
    expect(exit.value.returned._tag).toBe("OperationNotFound");
  });
});

describe("Tokens.forget on a receive", () => {
  it.each([
    ["pending", "done"],
    ["failed", "done"],
    ["done", "InvalidTransferTransition"],
  ] as const)("from %s ends %s", async (from, outcome) => {
    const { run } = makeHarness();

    const exit = await run(
      Effect.gen(function* () {
        const transfer = yield* seedTransfer("receive", from, mint, tokenA, 6);
        const result = yield* Effect.either(
          (yield* Tokens).forget(transfer.id),
        );
        const { operations } = yield* inventory;
        return Either.isRight(result)
          ? operationById(operations, transfer.id)?.status
          : result.left._tag;
      }),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value).toBe(outcome);
  });
});

interface Seed {
  readonly kind: "send" | "receive";
  readonly status: OperationStatus;
  readonly error?: string;
}

/** Seeds one transfer over tokenA (its proofs out for a send) and returns it. */
const returnSeeded = (seed: Seed) =>
  Effect.gen(function* () {
    const transfer = yield* seedTransfer(
      seed.kind,
      seed.status,
      mint,
      tokenA,
      6,
      seed.error ?? null,
    );
    if (seed.kind === "send") {
      yield* seedProofs(
        mint,
        proofsA,
        seed.status === "externalized" ? "externalized" : "handedOut",
        transfer.id,
      );
    }
    const result = yield* Effect.either(
      (yield* Tokens).returnToWallet(transfer.id),
    );
    const { proofs, operations } = yield* inventory;
    return {
      transfer,
      result,
      proofs,
      stored: operationById(operations, transfer.id),
    };
  });

describe("Tokens.returnToWallet", () => {
  it.each(["issued", "pending", "externalized"] as const)(
    "re-receives a %s send: fresh proofs in, handed-out proofs dead, send returned",
    async (status) => {
      const { run, events } = makeHarness({
        receive: () => Promise.resolve(swappedProofs),
      });

      const exit = await run(returnSeeded({ kind: "send", status }));

      assert(Exit.isSuccess(exit));
      const { transfer, result, proofs, stored } = exit.value;
      assert(result._tag === "Right");
      expect(result.right).toMatchObject({
        operationId: transfer.id,
        mint,
        unit: "sat",
        amount: 5,
      });
      expect(result.right.tokenText).not.toBe(tokenA);

      expect(secretsOf(proofsIn(proofs, "available"))).toEqual([
        "fresh-1",
        "fresh-2",
      ]);
      expect(
        proofsIn(proofs, "available").every((p) => p.operationId === null),
      ).toBe(true);
      expect(secretsOf(proofsIn(proofs, "spent"))).toEqual([
        "sec-a1",
        "sec-a2",
      ]);
      expect(stored).toMatchObject({ status: "returned", error: null });

      // The handed-out proofs die only once the fresh ones are stored.
      expect(
        events
          .filter((event) => event._tag === "ProofsChanged")
          .map((event) => [event.from, event.to, event.reason]),
      ).toEqual([
        [null, "available", "returnToWallet"],
        [
          status === "externalized" ? "externalized" : "handedOut",
          "spent",
          "returnToWallet",
        ],
      ]);
      expect(events.at(-1)).toMatchObject({
        name: "tokens.returnToWallet",
        params: { operationId: transfer.id },
        result: { operationId: transfer.id, amount: 5 },
      });
      const serialized = JSON.stringify(events);
      expect(serialized).not.toContain("cashu");
      expect(serialized).not.toContain("fresh-1");
    },
  );

  it("retries a failed receive in place", async () => {
    const { run, events } = makeHarness({
      receive: () => Promise.resolve(swappedProofs),
    });

    const exit = await run(
      returnSeeded({ kind: "receive", status: "failed", error: rejected }),
    );

    assert(Exit.isSuccess(exit));
    const { transfer, result, proofs, stored } = exit.value;
    assert(result._tag === "Right");
    expect(result.right.operationId).toBe(transfer.id);
    expect(secretsOf(proofsIn(proofs, "available"))).toEqual([
      "fresh-1",
      "fresh-2",
    ]);
    expect(stored).toMatchObject({ status: "done", error: null });
    expect(
      events
        .filter((event) => event._tag === "OperationChanged")
        .map((event) => [event.from, event.to]),
    ).toEqual([
      ["failed", "pending"],
      ["pending", "done"],
    ]);
  });

  it.each([
    ["send", "done", "returned"],
    ["send", "returned", "returned"],
    ["receive", "done", "done"],
  ] as const)(
    "rejects a %s in status %s: there is nothing to bring back",
    async (kind, status, to) => {
      const { run, receiveCalls } = makeHarness();

      const exit = await run(returnSeeded({ kind, status }));

      assert(Exit.isSuccess(exit));
      assert(exit.value.result._tag === "Left");
      expect(exit.value.result.left).toMatchObject({
        _tag: "InvalidTransferTransition",
        from: status,
        to,
      });
      expect(receiveCalls()).toBe(0);
      expect(exit.value.stored?.status).toBe(status);
    },
  );

  it("closes an issued send as claimed when the mint says its proofs are gone", async () => {
    const { run } = makeHarness({
      receive: () =>
        Promise.reject(new MintOperationError(11001, "Token already spent.")),
    });

    const exit = await run(returnSeeded({ kind: "send", status: "issued" }));

    assert(Exit.isSuccess(exit));
    const { result, proofs, stored } = exit.value;
    assert(result._tag === "Left");
    expect(result.left).toMatchObject({ _tag: "TokenAlreadySpent", mint });
    expect(secretsOf(proofsIn(proofs, "spent"))).toEqual(["sec-a1", "sec-a2"]);
    expect(proofsIn(proofs, "available")).toEqual([]);
    expect(stored?.status).toBe("done");
    expect(JSON.parse(stored?.error ?? "")).toMatchObject({
      _tag: "TokenAlreadySpent",
    });
  });

  it("leaves an issued send untouched when the mint is unreachable", async () => {
    const { run } = makeHarness({
      receive: () => Promise.reject(new TypeError("fetch failed")),
    });

    const exit = await run(returnSeeded({ kind: "send", status: "issued" }));

    assert(Exit.isSuccess(exit));
    const { result, proofs, stored } = exit.value;
    assert(result._tag === "Left");
    expect(result.left._tag).toBe("MintUnreachable");
    expect(secretsOf(proofsIn(proofs, "handedOut"))).toEqual([
      "sec-a1",
      "sec-a2",
    ]);
    expect(stored).toMatchObject({ status: "issued", error: null });
  });

  it("keeps an externalized send in its status on a definitive rejection, recording it", async () => {
    const { run } = makeHarness({
      receive: () =>
        Promise.reject(new MintOperationError(20003, "keyset inactive")),
    });

    const exit = await run(
      returnSeeded({ kind: "send", status: "externalized" }),
    );

    assert(Exit.isSuccess(exit));
    const { result, proofs, stored } = exit.value;
    assert(result._tag === "Left");
    expect(result.left._tag).toBe("MintRejected");
    expect(secretsOf(proofsIn(proofs, "externalized"))).toEqual([
      "sec-a1",
      "sec-a2",
    ]);
    expect(stored?.status).toBe("externalized");
    expect(JSON.parse(stored?.error ?? "")).toMatchObject({
      _tag: "MintRejected",
      code: 20003,
    });
  });

  it("fails a retried receive again with the new error", async () => {
    const { run, events } = makeHarness({
      receive: () => Promise.reject(new TypeError("fetch failed")),
    });

    const exit = await run(
      returnSeeded({ kind: "receive", status: "failed", error: rejected }),
    );

    assert(Exit.isSuccess(exit));
    const { result, proofs, stored } = exit.value;
    assert(result._tag === "Left");
    expect(result.left._tag).toBe("MintUnreachable");
    expect(proofs).toEqual([]);
    expect(stored?.status).toBe("failed");
    expect(JSON.parse(stored?.error ?? "")).toMatchObject({
      _tag: "MintUnreachable",
    });
    expect(
      events
        .filter((event) => event._tag === "OperationChanged")
        .map((event) => [event.from, event.to]),
    ).toEqual([
      ["failed", "pending"],
      ["pending", "failed"],
    ]);
  });
});

describe("Tokens.importProofs", () => {
  const draft = (cashuProof: CashuProof, state: ProofState = "available") =>
    new ImportProofDraft({
      mint,
      unit: sat,
      keysetId: KeysetId.make(cashuProof.id),
      amount: Amount.make(cashuProof.amount.toNumber()),
      secret: cashuProof.secret,
      C: cashuProof.C,
      dleq: null,
      state,
      operationId: null,
    });

  it("stores the proofs as the backup states them, skipping known secrets", async () => {
    const { run, events, receiveCalls } = makeHarness();

    const exit = await run(
      Effect.gen(function* () {
        const tokens = yield* Tokens;
        const first = yield* tokens.importProofs([
          draft(proof(4, "sec-a1")),
          draft(proof(8, "sec-b1"), "handedOut"),
        ]);
        const second = yield* tokens.importProofs([
          draft(proof(4, "sec-a1")),
          draft(proof(16, "sec-c1")),
        ]);
        return { first, second, ...(yield* inventory) };
      }),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.first).toBe(2);
    expect(exit.value.second).toBe(1);
    expect(
      exit.value.proofs.map((p) => [p.secret, p.state, p.amount]).sort(),
    ).toEqual([
      ["sec-a1", "available", 4],
      ["sec-b1", "handedOut", 8],
      ["sec-c1", "available", 16],
    ]);
    expect(receiveCalls()).toBe(0);
    expect(events[0]).toMatchObject({
      _tag: "ProofsChanged",
      from: null,
      count: 2,
      amount: 12,
      reason: "import",
    });
    expect(events[1]).toMatchObject({
      _tag: "OperationSucceeded",
      name: "tokens.importProofs",
      params: { count: 2 },
      result: 2,
    });
    expect(JSON.stringify(events)).not.toContain("sec-a1");
  });
});

describe("Tokens.importOperation", () => {
  it("stores the operation and replaces one with the same key", async () => {
    const { run } = makeHarness();

    const exit = await run(
      Effect.gen(function* () {
        const tokens = yield* Tokens;
        const first = yield* tokens.importOperation(quoteOperation({}));
        const second = yield* tokens.importOperation(
          quoteOperation({ status: "paid" }),
        );
        return { first, second, ...(yield* inventory) };
      }),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.second).toBe(exit.value.first);
    expect(exit.value.operations).toHaveLength(1);
    expect(exit.value.operations[0]).toMatchObject({
      id: exit.value.first,
      kind: "melt",
      status: "paid",
    });
  });
});

describe("Tokens.ingestLegacyRows", () => {
  const legacyRow = (
    id: string,
    tokenText: TokenText,
    state: LegacyTokenRow["state"],
    error: string | null = null,
  ): LegacyTokenRow =>
    new LegacyTokenRow({
      id,
      originalTokenText: tokenText,
      tokenText,
      state,
      error,
      createdAt: UnixSeconds.make(1_600_000_000),
    });

  const tokenC = tokenOf(proof(16, "sec-c1"));
  const tokenD = tokenOf(proof(32, "sec-d1"));
  const tokenE = tokenOf(proof(64, "sec-e1"));
  const tokenF = tokenOf(proof(128, "sec-f1"));
  const tokenG = tokenOf(proof(256, "sec-g1"));

  it("maps every legacy state onto proofs and operations", async () => {
    const { run, receiveCalls } = makeHarness();
    const rows = [
      legacyRow("pending", tokenA, "pending"),
      legacyRow("accepted", tokenB, "accepted"),
      legacyRow("issued", tokenC, "issued"),
      legacyRow("externalized", tokenD, "externalized"),
      legacyRow(
        "spent",
        tokenE,
        "error",
        encodeSpent(new TokenAlreadySpent({ mint })),
      ),
      legacyRow("rejected", tokenF, "error", rejected),
      legacyRow("broken", TokenText.make("cashuBnotatoken"), "accepted"),
    ];

    const exit = await run(
      Effect.gen(function* () {
        const report = yield* (yield* Tokens).ingestLegacyRows(rows);
        return { report, ...(yield* inventory) };
      }),
    );

    assert(Exit.isSuccess(exit));
    const { report, proofs, operations } = exit.value;
    expect(report).toMatchObject({ ingestedRows: 5, proofs: 5 });
    expect(receiveCalls()).toBe(0);

    expect(stateOf(proofs, "sec-a1")).toBeUndefined();
    expect(stateOf(proofs, "sec-b1")).toBe("available");
    expect(stateOf(proofs, "sec-e1")).toBe("spent");
    expect(stateOf(proofs, "sec-f1")).toBe("available");

    const issued = operations.find((op) => op.tokenText === tokenC);
    expect(issued).toMatchObject({
      kind: "send",
      status: "issued",
      mint,
      amount: 16,
      createdAt: 1_600_000_000,
    });
    expect(proofs.find((p) => p.secret === "sec-c1")).toMatchObject({
      state: "handedOut",
      operationId: issued?.id,
    });
    const externalized = operations.find((op) => op.tokenText === tokenD);
    expect(externalized).toMatchObject({
      kind: "send",
      status: "externalized",
    });
    expect(proofs.find((p) => p.secret === "sec-d1")).toMatchObject({
      state: "externalized",
      operationId: externalized?.id,
    });
    expect(operations).toHaveLength(2);
  });

  it("holds reserved rows under the pending melt whose inputs sum to them", async () => {
    const { run } = makeHarness();

    const exit = await run(
      Effect.gen(function* () {
        const melt = yield* seedOperation(
          quoteOperation({ inputsTotal: Amount.make(6) }),
        );
        const report = yield* (yield* Tokens).ingestLegacyRows([
          legacyRow("linked", tokenA, "reserved"),
          legacyRow("orphan", tokenB, "reserved"),
        ]);
        return { melt, report, ...(yield* inventory) };
      }),
    );

    assert(Exit.isSuccess(exit));
    const { melt, report, proofs } = exit.value;
    expect(report).toMatchObject({ ingestedRows: 2, proofs: 3 });
    expect(proofs.every((p) => p.state === "held")).toBe(true);
    expect(proofs.find((p) => p.secret === "sec-a1")?.operationId).toBe(
      melt.id,
    );
    expect(proofs.find((p) => p.secret === "sec-a2")?.operationId).toBe(
      melt.id,
    );
    expect(proofs.find((p) => p.secret === "sec-b1")?.operationId).toBeNull();
  });

  it("skips proofs the inventory already holds and is idempotent", async () => {
    const { run, events } = makeHarness();

    const exit = await run(
      Effect.gen(function* () {
        yield* seedProofs(mint, [proof(8, "sec-b1")], "spent");
        const tokens = yield* Tokens;
        const rows = [
          legacyRow("known", tokenB, "accepted"),
          legacyRow("fresh", tokenG, "issued"),
        ];
        const first = yield* tokens.ingestLegacyRows(rows);
        const before = yield* inventory;
        const second = yield* tokens.ingestLegacyRows(rows);
        const after = yield* inventory;
        return { first, second, before, after };
      }),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.first).toMatchObject({ ingestedRows: 1, proofs: 1 });
    expect(exit.value.second).toMatchObject({ ingestedRows: 0, proofs: 0 });
    expect(stateOf(exit.value.before.proofs, "sec-b1")).toBe("spent");
    expect(amountIn(exit.value.before.proofs, "handedOut")).toBe(256);
    expect(exit.value.after).toEqual(exit.value.before);
    expect(events.filter((e) => e._tag === "OperationChanged")).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({
      name: "tokens.ingestLegacyRows",
      params: { rows: 2 },
      result: { ingestedRows: 0, proofs: 0 },
    });
    expect(JSON.stringify(events)).not.toContain("cashu");
  });
});
