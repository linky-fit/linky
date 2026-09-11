import type { Proof as CashuProof } from "@cashu/cashu-ts";
import { getEncodedToken } from "@cashu/cashu-ts";
import { Effect, Exit, Layer } from "effect";
import { MintUnreachable } from "../domain/errors";
import { MintUrl, OperationId, TokenText } from "../domain/primitives";
import { WalletInstances } from "../mint/internal/WalletInstances";
import type { LoadedWallet } from "../mint/internal/WalletInstances";
import { inMemoryKeyValueStore } from "../ports/inMemoryKeyValueStore";
import { inMemoryOperationStore } from "../ports/inMemoryOperationStore";
import { inMemoryProofStore } from "../ports/inMemoryProofStore";
import { OperationStore } from "../ports/OperationStore";
import type { OperationStatus } from "../ports/OperationStore";
import { ProofStore } from "../ports/ProofStore";
import type { ProofState, StoredProof } from "../ports/ProofStore";
import { fakeWallet, proof } from "../testing/fakeWallet";
import type { ProofStateName } from "../testing/fakeWallet";
import { recordingInspector } from "../testing/inspector";
import { proofsIn, seedProofs, seedTransfer } from "../testing/inventory";
import { Validation } from "./Validation";

const mint = MintUrl.make("https://mint.example");
const otherMint = MintUrl.make("https://other.example");

const tokenOf = (...proofs: ReadonlyArray<CashuProof>): TokenText =>
  TokenText.make(getEncodedToken({ mint, unit: "sat", proofs: [...proofs] }));

const a1 = proof(4, "sec-a1");
const a2 = proof(2, "sec-a2");
const b1 = proof(8, "sec-b1");
const z1 = proof(3, "sec-z1");
const o1 = proof(16, "sec-o1");
const tokenA = tokenOf(a1, a2);
const tokenB = tokenOf(b1);

interface HarnessArgs {
  stateOf?: (secret: string) => ProofStateName;
  checkStatesError?: unknown;
  /** Answer fewer states than asked, to emulate a truncated response. */
  truncateTo?: number;
  walletUnreachable?: boolean;
}

const makeWallet = (args: HarnessArgs): LoadedWallet =>
  fakeWallet({
    checkProofsStates: (proofs) =>
      args.checkStatesError !== undefined
        ? Promise.reject(args.checkStatesError)
        : Promise.resolve(
            proofs.slice(0, args.truncateTo ?? proofs.length).map((entry) => ({
              Y: entry.secret ?? "",
              state: args.stateOf?.(entry.secret ?? "") ?? "UNSPENT",
              witness: null,
            })),
          ),
  });

const makeHarness = (args: HarnessArgs = {}) => {
  const inspector = recordingInspector();
  const wallet = makeWallet(args);
  const layer = Validation.DefaultWithoutDependencies.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.succeed(
          WalletInstances,
          WalletInstances.make({
            // Only the mint under test loads; anything else is a second mint
            // this wallet cannot reach right now.
            get: (requested) =>
              requested === mint && args.walletUnreachable !== true
                ? Effect.succeed(wallet)
                : Effect.fail(
                    new MintUnreachable({ mint: requested, detail: null }),
                  ),
          }),
        ),
        inMemoryKeyValueStore,
        inMemoryProofStore,
        inMemoryOperationStore,
        inspector.layer,
      ),
    ),
  );
  const run = <A, E>(
    program: Effect.Effect<A, E, Validation | ProofStore | OperationStore>,
  ) => Effect.runPromiseExit(program.pipe(Effect.provide(layer)));
  return { run, events: inspector.events };
};

interface ProofSeed {
  readonly proofs: ReadonlyArray<CashuProof>;
  readonly state?: ProofState;
  readonly operationId?: OperationId | null;
  readonly mint?: MintUrl;
}

/** Seeds proofs, runs one validation call, and reports the resulting inventory. */
const withProofs = <A, E>(
  seeds: ReadonlyArray<ProofSeed>,
  operation: (validation: Validation) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    yield* Effect.forEach(seeds, (seed) =>
      seedProofs(
        seed.mint ?? mint,
        seed.proofs,
        seed.state ?? "available",
        seed.operationId ?? null,
      ),
    );
    const result = yield* operation(yield* Validation);
    return { result, proofs: yield* (yield* ProofStore).loadAll };
  });

const stateOfSecret = (
  proofs: ReadonlyArray<StoredProof>,
  secret: string,
): ProofState | undefined =>
  proofs.find((proof) => proof.secret === secret)?.state;

const statesOf = (proofs: ReadonlyArray<StoredProof>): ReadonlyArray<string> =>
  proofs.map((proof) => proof.state);

/** A `send` transfer carrying `tokenText`, with its proofs handed out under it. */
const seedSend = (
  status: OperationStatus,
  tokenText: TokenText,
  proofs: ReadonlyArray<CashuProof>,
  proofState: ProofState = "handedOut",
) =>
  Effect.gen(function* () {
    const operation = yield* seedTransfer(
      "send",
      status,
      mint,
      tokenText,
      proofs.reduce((sum, entry) => sum + entry.amount.toNumber(), 0),
    );
    yield* seedProofs(mint, proofs, proofState, operation.id);
    return operation;
  });

const operationStatus = (id: OperationId) =>
  Effect.map(
    Effect.flatMap(OperationStore, (store) => store.loadAll),
    (operations) => operations.find((operation) => operation.id === id)?.status,
  );

describe("Validation.checkAll", () => {
  it("marks spent proofs spent, leaves the rest, and reports the unreachable mint", async () => {
    const { run, events } = makeHarness({
      stateOf: (secret) => (secret === "sec-z1" ? "SPENT" : "UNSPENT"),
    });

    const exit = await run(
      withProofs(
        [
          { proofs: [a1, a2] },
          { proofs: [b1] },
          { proofs: [z1] },
          { proofs: [o1], mint: otherMint },
        ],
        (validation) => validation.checkAll,
      ),
    );

    assert(Exit.isSuccess(exit));
    const { result, proofs } = exit.value;

    expect(result.checkedProofs).toBe(4);
    expect(result.markedSpent).toHaveLength(1);
    expect(result.markedSpent[0]?.amount).toBe(3);
    expect(result.released).toBe(0);
    // The other mint is its own group, and it is not reachable here.
    expect(result.unavailableMints).toEqual([otherMint]);

    expect(stateOfSecret(proofs, "sec-z1")).toBe("spent");
    expect(stateOfSecret(proofs, "sec-o1")).toBe("available");
    expect(proofsIn(proofs, "available")).toHaveLength(4);
    // Nothing is deleted: the spent proof stays for dedup.
    expect(proofs).toHaveLength(5);

    // No key material: neither token text nor proof secrets in any event.
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("cashu");
    expect(serialized).not.toContain("sec-a1");
    expect(events).toContainEqual(
      expect.objectContaining({
        _tag: "ProofsChanged",
        from: "available",
        to: "spent",
        amount: 3,
        reason: "validation",
      }),
    );
  });

  it("releases proofs held by an unknown operation once the mint reports them unspent", async () => {
    const { run } = makeHarness();
    const knownMelt = OperationId.make("melt-1");

    const exit = await run(
      withProofs(
        [
          { proofs: [b1], state: "held", operationId: null },
          { proofs: [a1], state: "held", operationId: knownMelt },
        ],
        (validation) => validation.checkAll,
      ),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.result.released).toBe(1);
    // The proof a known melt holds belongs to that melt's resumer.
    expect(exit.value.result.checkedProofs).toBe(1);
    expect(stateOfSecret(exit.value.proofs, "sec-b1")).toBe("available");
    expect(stateOfSecret(exit.value.proofs, "sec-a1")).toBe("held");
  });

  it("keeps a held-by-unknown proof held while the mint reports it pending", async () => {
    const { run } = makeHarness({ stateOf: () => "PENDING" });

    const exit = await run(
      withProofs(
        [{ proofs: [b1], state: "held", operationId: null }],
        (validation) => validation.checkAll,
      ),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.result.released).toBe(0);
    expect(stateOfSecret(exit.value.proofs, "sec-b1")).toBe("held");
  });

  it("marks only the spent proof; its neighbour stays available", async () => {
    const { run } = makeHarness({
      stateOf: (secret) => (secret === "sec-a1" ? "SPENT" : "UNSPENT"),
    });

    const exit = await run(
      withProofs([{ proofs: [a1, a2] }], (validation) => validation.checkAll),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.result.markedSpent.map((entry) => entry.amount)).toEqual([
      4,
    ]);
    expect(stateOfSecret(exit.value.proofs, "sec-a1")).toBe("spent");
    expect(stateOfSecret(exit.value.proofs, "sec-a2")).toBe("available");
  });

  it("changes nothing when every proof is still unspent", async () => {
    const { run, events } = makeHarness();

    const exit = await run(
      withProofs([{ proofs: [a1, a2] }], (validation) => validation.checkAll),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.result.markedSpent).toEqual([]);
    expect(statesOf(exit.value.proofs)).toEqual(["available", "available"]);
    expect(
      events.filter(
        (event) => event._tag === "ProofsChanged" && event.from !== null,
      ),
    ).toEqual([]);
  });

  it("leaves unanswered proofs untouched on a truncated response", async () => {
    const { run } = makeHarness({ stateOf: () => "SPENT", truncateTo: 1 });

    const exit = await run(
      withProofs(
        [{ proofs: [a1, a2] }, { proofs: [b1] }],
        (validation) => validation.checkAll,
      ),
    );

    assert(Exit.isSuccess(exit));
    // Only the first of the three proofs was answered.
    expect(exit.value.result.checkedProofs).toBe(1);
    expect(exit.value.result.markedSpent.map((entry) => entry.amount)).toEqual([
      4,
    ]);
    expect(stateOfSecret(exit.value.proofs, "sec-a2")).toBe("available");
    expect(stateOfSecret(exit.value.proofs, "sec-b1")).toBe("available");
  });

  it("treats a pending proof as unknown rather than spent", async () => {
    const { run } = makeHarness({
      stateOf: (secret) => (secret === "sec-a1" ? "PENDING" : "SPENT"),
    });

    const exit = await run(
      withProofs([{ proofs: [a1, a2] }], (validation) => validation.checkAll),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.result.markedSpent.map((entry) => entry.amount)).toEqual([
      2,
    ]);
    expect(stateOfSecret(exit.value.proofs, "sec-a1")).toBe("available");
  });

  it("reports a failed check as an unavailable mint and touches nothing", async () => {
    const { run } = makeHarness({
      checkStatesError: new TypeError("fetch failed"),
    });

    const exit = await run(
      withProofs([{ proofs: [a1, a2] }], (validation) => validation.checkAll),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.result.unavailableMints).toEqual([mint]);
    expect(exit.value.result.checkedProofs).toBe(0);
    expect(statesOf(exit.value.proofs)).toEqual(["available", "available"]);
  });

  it("reports an unloadable mint as unavailable", async () => {
    const { run } = makeHarness({ walletUnreachable: true });

    const exit = await run(
      withProofs([{ proofs: [a1] }], (validation) => validation.checkAll),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.result.unavailableMints).toEqual([mint]);
    expect(stateOfSecret(exit.value.proofs, "sec-a1")).toBe("available");
  });

  it("does not ask about handed-out or already spent proofs", async () => {
    const { run } = makeHarness({ stateOf: () => "SPENT" });

    const exit = await run(
      Effect.gen(function* () {
        yield* seedSend("issued", tokenB, [b1]);
        return yield* withProofs(
          [{ proofs: [z1], state: "spent" }],
          (validation) => validation.checkAll,
        );
      }),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.result.checkedProofs).toBe(0);
    expect(exit.value.result.markedSpent).toEqual([]);
    expect(stateOfSecret(exit.value.proofs, "sec-b1")).toBe("handedOut");
  });
});

describe("Validation.checkTransfer", () => {
  const checkSend = (status: OperationStatus = "issued") =>
    Effect.gen(function* () {
      const operation = yield* seedSend(status, tokenA, [a1, a2]);
      const result = yield* (yield* Validation).checkTransfer(operation.id);
      return {
        result,
        proofs: yield* (yield* ProofStore).loadAll,
        status: yield* operationStatus(operation.id),
      };
    });

  const checkReceive = () =>
    Effect.gen(function* () {
      const operation = yield* seedTransfer("receive", "done", mint, tokenB, 8);
      const result = yield* (yield* Validation).checkTransfer(operation.id);
      return { result, proofs: yield* (yield* ProofStore).loadAll };
    });

  it("closes a handed-out send as claimed once every proof is spent", async () => {
    const { run, events } = makeHarness({ stateOf: () => "SPENT" });

    const exit = await run(checkSend());

    assert(Exit.isSuccess(exit));
    expect(exit.value.result.status).toBe("spent");
    expect(statesOf(exit.value.proofs)).toEqual(["spent", "spent"]);
    // Spent proofs still name the send that handed them out.
    expect(exit.value.proofs.every((proof) => proof.operationId !== null)).toBe(
      true,
    );
    expect(exit.value.status).toBe("done");
    expect(events).toContainEqual(
      expect.objectContaining({
        _tag: "OperationChanged",
        kind: "send",
        from: "issued",
        to: "done",
        reason: "claimed",
      }),
    );
  });

  it("reports a live send and marks what the mint took", async () => {
    const { run } = makeHarness({
      stateOf: (secret) => (secret === "sec-a1" ? "SPENT" : "UNSPENT"),
    });

    const exit = await run(checkSend());

    assert(Exit.isSuccess(exit));
    expect(exit.value.result.status).toBe("live");
    expect(stateOfSecret(exit.value.proofs, "sec-a1")).toBe("spent");
    expect(stateOfSecret(exit.value.proofs, "sec-a2")).toBe("handedOut");
    expect(exit.value.status).toBe("issued");
  });

  it("reports unavailable when the mint gives no usable answer", async () => {
    const { run } = makeHarness({
      checkStatesError: new TypeError("fetch failed"),
    });

    const exit = await run(checkSend());

    assert(Exit.isSuccess(exit));
    expect(exit.value.result.status).toBe("unavailable");
    expect(statesOf(exit.value.proofs)).toEqual(["handedOut", "handedOut"]);
  });

  it("reports unavailable when the mint answers for only some proofs", async () => {
    const { run } = makeHarness({ truncateTo: 1 });

    const exit = await run(checkSend());

    assert(Exit.isSuccess(exit));
    expect(exit.value.result.status).toBe("unavailable");
  });

  it("reports a returned send with no proofs left out as spent", async () => {
    const { run } = makeHarness();

    const exit = await run(
      Effect.gen(function* () {
        const operation = yield* seedSend(
          "returned",
          tokenA,
          [a1, a2],
          "spent",
        );
        return yield* (yield* Validation).checkTransfer(operation.id);
      }),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.status).toBe("spent");
  });

  it("asks the mint about a received token's own proofs", async () => {
    const live = makeHarness();
    const claimed = makeHarness({ stateOf: () => "SPENT" });

    const liveExit = await live.run(checkReceive());
    const claimedExit = await claimed.run(checkReceive());

    assert(Exit.isSuccess(liveExit));
    assert(Exit.isSuccess(claimedExit));
    expect(liveExit.value.result.status).toBe("live");
    expect(claimedExit.value.result.status).toBe("spent");
    // A receive's proofs are not the wallet's: nothing to mark either way.
    expect(claimedExit.value.proofs).toEqual([]);
  });

  it("reports a received token unavailable when its mint cannot be reached", async () => {
    const { run } = makeHarness({ walletUnreachable: true });

    const exit = await run(checkReceive());

    assert(Exit.isSuccess(exit));
    expect(exit.value.result.status).toBe("unavailable");
  });

  it("fails with OperationNotFound for an unknown operation", async () => {
    const { run } = makeHarness();

    const exit = await run(
      Effect.flatMap(Validation, (validation) =>
        Effect.flip(validation.checkTransfer(OperationId.make("missing"))),
      ),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value).toMatchObject({
      _tag: "OperationNotFound",
      operationId: "missing",
    });
  });
});

describe("Validation.checkIssued", () => {
  it("closes the send whose recipient claimed it and leaves the other alone", async () => {
    const { run } = makeHarness({
      stateOf: (secret) => (secret === "sec-b1" ? "SPENT" : "UNSPENT"),
    });

    const exit = await run(
      Effect.gen(function* () {
        const sendA = yield* seedSend("issued", tokenA, [a1, a2]);
        const sendB = yield* seedSend("issued", tokenB, [b1]);
        const result = yield* (yield* Validation).checkIssued;
        return {
          result,
          sendB,
          proofs: yield* (yield* ProofStore).loadAll,
          statusA: yield* operationStatus(sendA.id),
          statusB: yield* operationStatus(sendB.id),
        };
      }),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.result.claimed).toEqual([
      expect.objectContaining({ operationId: exit.value.sendB.id, amount: 8 }),
    ]);
    expect(exit.value.statusB).toBe("done");
    expect(exit.value.statusA).toBe("issued");
    expect(
      exit.value.proofs.find((proof) => proof.secret === "sec-b1"),
    ).toMatchObject({ state: "spent", operationId: exit.value.sendB.id });
    expect(stateOfSecret(exit.value.proofs, "sec-a1")).toBe("handedOut");
  });

  it.each([
    { status: "issued", proofState: "handedOut" },
    { status: "pending", proofState: "handedOut" },
    { status: "externalized", proofState: "externalized" },
  ] as const)(
    "closes a $status send once its $proofState proofs are all spent",
    async ({ status, proofState }) => {
      const { run } = makeHarness({ stateOf: () => "SPENT" });

      const exit = await run(
        Effect.gen(function* () {
          const send = yield* seedSend(status, tokenB, [b1], proofState);
          const result = yield* (yield* Validation).checkIssued;
          return { result, status: yield* operationStatus(send.id) };
        }),
      );

      assert(Exit.isSuccess(exit));
      expect(exit.value.result.claimed).toHaveLength(1);
      expect(exit.value.status).toBe("done");
    },
  );

  it("keeps an unclaimed send untouched and never looks at the balance", async () => {
    const { run } = makeHarness({
      stateOf: (secret) => (secret === "sec-z1" ? "SPENT" : "UNSPENT"),
    });

    const exit = await run(
      Effect.gen(function* () {
        const send = yield* seedSend("issued", tokenA, [a1, a2]);
        yield* seedProofs(mint, [z1]);
        const result = yield* (yield* Validation).checkIssued;
        return {
          result,
          proofs: yield* (yield* ProofStore).loadAll,
          status: yield* operationStatus(send.id),
        };
      }),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.result.claimed).toEqual([]);
    expect(exit.value.status).toBe("issued");
    expect(statesOf(exit.value.proofs)).toEqual([
      "handedOut",
      "handedOut",
      "available",
    ]);
  });

  it("does not close a send whose proofs are only partly spent", async () => {
    const { run } = makeHarness({
      stateOf: (secret) => (secret === "sec-a1" ? "SPENT" : "UNSPENT"),
    });

    const exit = await run(
      Effect.gen(function* () {
        const send = yield* seedSend("issued", tokenA, [a1, a2]);
        const result = yield* (yield* Validation).checkIssued;
        return {
          result,
          proofs: yield* (yield* ProofStore).loadAll,
          status: yield* operationStatus(send.id),
        };
      }),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.result.claimed).toEqual([]);
    expect(exit.value.status).toBe("issued");
    expect(stateOfSecret(exit.value.proofs, "sec-a1")).toBe("spent");
    expect(stateOfSecret(exit.value.proofs, "sec-a2")).toBe("handedOut");
  });
});

describe("Validation.inspectProofStates", () => {
  it("snapshots every unspent proof without changing it or exposing secrets", async () => {
    const { run, events } = makeHarness({
      stateOf: (secret) =>
        secret === "sec-a2"
          ? "PENDING"
          : secret === "sec-b1"
            ? "SPENT"
            : "UNSPENT",
    });

    const exit = await run(
      withProofs(
        [
          { proofs: [a1, a2] },
          { proofs: [b1], state: "held", operationId: null },
          { proofs: [z1], state: "spent" },
          { proofs: [o1], mint: otherMint },
        ],
        (validation) => validation.inspectProofStates,
      ),
    );

    assert(Exit.isSuccess(exit));
    const { result, proofs } = exit.value;
    const idOf = (secret: string) =>
      proofs.find((proof) => proof.secret === secret)?.id;
    expect(result).toEqual([
      { proofId: idOf("sec-a1"), state: "unspent" },
      { proofId: idOf("sec-a2"), state: "pending" },
      { proofId: idOf("sec-b1"), state: "spent" },
      // The other mint cannot be reached: unknown, not spent.
      { proofId: idOf("sec-o1"), state: "unknown" },
    ]);
    // Read-only: the mint's answers change nothing in the store.
    expect(statesOf(proofs)).toEqual([
      "available",
      "available",
      "held",
      "spent",
      "available",
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({
        name: "validation.inspectProofStates",
        result,
      }),
    );
    expect(JSON.stringify(events)).not.toContain("sec-a1");
    expect(JSON.stringify(events)).not.toContain("cashu");
  });

  it("reports unanswered proofs as unknown, not pending", async () => {
    const { run } = makeHarness({ truncateTo: 1 });

    const exit = await run(
      withProofs(
        [{ proofs: [a1, a2] }],
        (validation) => validation.inspectProofStates,
      ),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.result.map((entry) => entry.state)).toEqual([
      "unspent",
      "unknown",
    ]);
  });

  it("rechecks a pending proof after the mint releases it", async () => {
    let pending = true;
    const { run } = makeHarness({
      stateOf: () => (pending ? "PENDING" : "UNSPENT"),
    });

    const exit = await run(
      Effect.gen(function* () {
        yield* seedProofs(mint, [a1]);
        const validation = yield* Validation;
        const before = yield* validation.inspectProofStates;
        pending = false;
        const after = yield* validation.inspectProofStates;
        return { before, after };
      }),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.before[0]?.state).toBe("pending");
    expect(exit.value.after[0]?.state).toBe("unspent");
  });
});
