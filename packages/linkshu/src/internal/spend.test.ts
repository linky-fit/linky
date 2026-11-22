import type {
  Proof as CashuProof,
  OutputType,
  SendResponse,
  SwapPreview,
} from "@cashu/cashu-ts";
import {
  Amount as CashuAmount,
  HttpResponseError,
  MintOperationError,
} from "@cashu/cashu-ts";
import { Effect, Exit } from "effect";
import { Amount, CurrencyUnit, KeysetId, MintUrl } from "../domain/primitives";
import type { LoadedWallet } from "../mint/internal/WalletInstances";
import { makeInMemoryKeyValueStore } from "../ports/inMemoryKeyValueStore";
import { ProofStore } from "../ports/ProofStore";
import type { ProofWrite } from "../ports/ProofStore";
import { inMemoryProofStore } from "../ports/inMemoryProofStore";
import {
  answerProofStates,
  fakeWallet,
  KEYSET_HEX,
  plannedOutput,
  proof,
} from "../testing/fakeWallet";
import type { ProofStateName } from "../testing/fakeWallet";
import { recordingInspector } from "../testing/inspector";
import {
  allProofs,
  proofsIn,
  secretsOf,
  seedProofs,
} from "../testing/inventory";
import { toDomainProofs } from "../token/internal/cashuProofs";
import { LOST_SWAP_KEY_PREFIX } from "./lostSwap";
import { toNewProofs } from "./proofs";
import {
  selectSpendableProofs,
  settleSwap,
  swapProofsForAmount,
} from "./spend";
import type { SpendContext, SpendSelection } from "./spend";

const mint = MintUrl.make("https://mint.example");
const otherMint = "https://other.example";
const sat = CurrencyUnit.make("sat");

interface HarnessArgs {
  stateOf?: (secret: string) => ProofStateName;
  checkStatesError?: unknown;
}

/** A spend context over fresh in-memory stores; `checked` records every NUT-07 ask. */
const makeHarness = (args: HarnessArgs = {}) => {
  const inspector = recordingInspector();
  const checked: string[][] = [];
  const wallet = fakeWallet({
    keysetId: KEYSET_HEX,
    checkProofsStates: (proofs) => {
      checked.push(proofs.map((entry) => entry.secret ?? ""));
      return args.checkStatesError !== undefined
        ? Promise.reject(args.checkStatesError)
        : Promise.resolve(
            proofs.map((entry) => ({
              Y: entry.secret ?? "",
              state: args.stateOf?.(entry.secret ?? "") ?? "UNSPENT",
              witness: null,
            })),
          );
    },
  });
  const run = <A, E>(
    program: (ctx: SpendContext) => Effect.Effect<A, E, ProofStore>,
  ) =>
    Effect.runPromiseExit(
      Effect.flatMap(ProofStore, (proofStore) =>
        program({
          kv: makeInMemoryKeyValueStore(),
          proofStore,
          inspector: inspector.service,
          wallet,
          mint,
          unit: sat,
          reason: "test",
        }),
      ).pipe(Effect.provide(inMemoryProofStore)),
    );
  return { run, checked, events: inspector.events };
};

/** `ctx` whose store records every write batch into `writes`. */
const recordingWrites = (ctx: SpendContext, writes: ProofWrite[]) => ({
  ...ctx,
  proofStore: {
    ...ctx.proofStore,
    write: (batch: ProofWrite) => {
      writes.push(batch);
      return ctx.proofStore.write(batch);
    },
  },
});

const handedOut = (secret: string) => {
  const rows = toNewProofs([proof(6, secret)], mint, sat, "handedOut", null);
  assert(rows !== null);
  return { proofs: rows, reason: "send" };
};

describe("selectSpendableProofs", () => {
  it("offers only available proofs at the mint the mint confirms unspent", async () => {
    const { run, checked, events } = makeHarness({
      stateOf: (secret) =>
        secret === "gone"
          ? "SPENT"
          : secret === "locked"
            ? "PENDING"
            : "UNSPENT",
    });

    const exit = await run((ctx) =>
      Effect.gen(function* () {
        yield* seedProofs(mint, [
          proof(4, "ok"),
          proof(2, "gone"),
          proof(8, "locked"),
        ]);
        yield* seedProofs(mint, [proof(16, "held")], "held");
        yield* seedProofs(mint, [proof(32, "out")], "handedOut");
        yield* seedProofs(otherMint, [proof(64, "foreign")]);
        const selection = yield* selectSpendableProofs(ctx);
        return { selection, proofs: yield* allProofs };
      }),
    );

    assert(Exit.isSuccess(exit));
    const { selection, proofs } = exit.value;
    expect(checked).toEqual([["ok", "gone", "locked"]]);
    expect(secretsOf(selection.spendable)).toEqual(["ok"]);
    expect(selection.available).toBe(4);
    // Spent knowledge sticks; a pending proof stays available for later.
    expect(secretsOf(proofsIn(proofs, "spent"))).toEqual(["gone"]);
    expect(secretsOf(proofsIn(proofs, "available"))).toEqual([
      "foreign",
      "locked",
      "ok",
    ]);
    expect(events).toEqual([
      expect.objectContaining({
        _tag: "ProofsChanged",
        mint,
        from: "available",
        to: "spent",
        count: 1,
        amount: 2,
        operationId: null,
        reason: "test",
      }),
    ]);
  });

  it("never asks the mint about an empty pool", async () => {
    const { run, checked } = makeHarness();

    const exit = await run((ctx) => selectSpendableProofs(ctx));

    expect(exit).toEqual(Exit.succeed({ spendable: [], available: 0 }));
    expect(checked).toEqual([]);
  });

  it("surfaces a failed NUT-07 check without touching the inventory", async () => {
    const { run } = makeHarness({
      checkStatesError: new TypeError("fetch failed"),
    });

    const exit = await run((ctx) =>
      Effect.gen(function* () {
        yield* seedProofs(mint, [proof(4, "ok")]);
        const error = yield* Effect.flip(selectSpendableProofs(ctx));
        return { error, proofs: yield* allProofs };
      }),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.error._tag).toBe("MintUnreachable");
    expect(secretsOf(proofsIn(exit.value.proofs, "available"))).toEqual(["ok"]);
  });
});

describe("settleSwap", () => {
  it("stores fresh change, marks consumed inputs spent, and leaves passthrough inputs alone", async () => {
    const { run, events } = makeHarness();

    const exit = await run((ctx) =>
      Effect.gen(function* () {
        const offered = yield* seedProofs(mint, [
          proof(4, "a1"),
          proof(2, "a2"),
          proof(8, "b1"),
        ]);
        const outcome = yield* settleSwap(
          ctx,
          offered,
          {
            keep: [proof(4, "a1"), proof(3, "change")],
            send: [proof(6, "s1")],
          },
          "settle",
        );
        return { outcome, proofs: yield* allProofs };
      }),
    );

    assert(Exit.isSuccess(exit));
    const { outcome, proofs } = exit.value;
    assert(outcome !== null);
    expect(secretsOf(outcome.freshKeep)).toEqual(["change"]);
    expect(secretsOf(outcome.consumed)).toEqual(["a2", "b1"]);
    expect(outcome.keepAmount).toBe(7);
    expect(secretsOf(proofsIn(proofs, "available"))).toEqual(["a1", "change"]);
    expect(secretsOf(proofsIn(proofs, "spent"))).toEqual(["a2", "b1"]);
    // The send proofs are the caller's to book; settling never stores them.
    expect(proofs.find((p) => p.secret === "s1")).toBeUndefined();
    expect(events.map((event) => event._tag)).toEqual([
      "ProofsChanged",
      "ProofsChanged",
    ]);
    expect(events[0]).toMatchObject({
      from: null,
      to: "available",
      amount: 3,
      reason: "settle",
    });
    expect(events[1]).toMatchObject({
      from: "available",
      to: "spent",
      amount: 10,
      reason: "settle",
    });
  });

  it("books the caller's proofs, the change and the consumed inputs in one write", async () => {
    const { run, events } = makeHarness();
    const writes: ProofWrite[] = [];

    const exit = await run((ctx) =>
      Effect.gen(function* () {
        const offered = yield* seedProofs(mint, [
          proof(4, "a1"),
          proof(8, "b1"),
        ]);
        const outcome = yield* settleSwap(
          recordingWrites(ctx, writes),
          offered,
          {
            keep: [proof(4, "a1"), proof(3, "change")],
            send: [proof(6, "s1")],
          },
          "settle",
          [handedOut("s1")],
        );
        return { outcome, proofs: yield* allProofs };
      }),
    );

    assert(Exit.isSuccess(exit));
    const { outcome, proofs } = exit.value;
    expect(secretsOf(outcome?.freshKeep ?? [])).toEqual(["change"]);
    expect(writes).toHaveLength(1);
    expect(secretsOf(writes[0]?.insert ?? [])).toEqual(["change", "s1"]);
    expect(writes[0]?.update?.map((entry) => entry.patch)).toEqual([
      { state: "spent", operationId: null },
    ]);
    expect(secretsOf(proofsIn(proofs, "handedOut"))).toEqual(["s1"]);
    expect(secretsOf(proofsIn(proofs, "spent"))).toEqual(["b1"]);
    expect(
      events.map((event) => ("reason" in event ? event.reason : null)),
    ).toEqual(["send", "settle", "settle"]);
  });

  it("refuses malformed change before touching anything", async () => {
    const { run } = makeHarness();

    const exit = await run((ctx) =>
      Effect.gen(function* () {
        const offered = yield* seedProofs(mint, [proof(4, "a1")]);
        const outcome = yield* settleSwap(
          ctx,
          offered,
          {
            keep: [{ ...proof(1, "bad"), C: "not-hex" }],
            send: [proof(3, "s1")],
          },
          "settle",
        );
        return { outcome, proofs: yield* allProofs };
      }),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.outcome).toBeNull();
    expect(secretsOf(proofsIn(exit.value.proofs, "available"))).toEqual(["a1"]);
  });

  it("still books the caller's proofs when the change is malformed", async () => {
    const { run } = makeHarness();

    const exit = await run((ctx) =>
      Effect.gen(function* () {
        const offered = yield* seedProofs(mint, [proof(4, "a1")]);
        const outcome = yield* settleSwap(
          ctx,
          offered,
          {
            keep: [{ ...proof(1, "bad"), C: "not-hex" }],
            send: [proof(3, "s1")],
          },
          "settle",
          [handedOut("s1")],
        );
        return { outcome, proofs: yield* allProofs };
      }),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.outcome).toBeNull();
    expect(secretsOf(proofsIn(exit.value.proofs, "available"))).toEqual(["a1"]);
    expect(secretsOf(proofsIn(exit.value.proofs, "handedOut"))).toEqual(["s1"]);
  });
});

describe("lost spend swaps", () => {
  const scope = { mint, unit: sat, keysetId: KeysetId.make(KEYSET_HEX) };
  const lostAnswer = () => new TypeError("fetch failed");

  type Answer =
    | "answer"
    | "lose"
    | "drop"
    | Error
    | { readonly ranThen: Error };

  /**
   * A mint that signs each swap's planned send (4) and keep (2) slots and
   * spends its inputs. `answer` runs and answers it, `lose` runs it and drops
   * the answer, `drop` never runs it, an error rejects it.
   */
  const swapMint = () => {
    const spent = new Set<string>();
    const pending = new Set<string>();
    const silent = new Set<string>();
    const signed = new Map<number, CashuProof>();
    const restores: Array<[number, number]> = [];
    const previews = new WeakMap<
      SwapPreview,
      { send: number; keep: number; inputs: string[] }
    >();
    const mint: {
      answer: Answer;
      readonly spent: Set<string>;
      readonly pending: Set<string>;
      readonly silent: Set<string>;
      readonly signed: Map<number, CashuProof>;
      readonly restores: Array<[number, number]>;
    } = { answer: "answer", spent, pending, silent, signed, restores };
    const wallet = fakeWallet({
      prepareSwapToSend: (_amount, proofs, _config, outputConfig) => {
        const preview: SwapPreview = {
          amount: CashuAmount.from(4),
          fees: CashuAmount.from(0),
          keysetId: KEYSET_HEX,
          inputs: proofs.map((input) => ({
            ...input,
            amount: CashuAmount.from(input.amount),
          })),
          sendOutputs: [plannedOutput(4)],
          keepOutputs: [plannedOutput(2)],
        };
        const counterOf = (type: OutputType | undefined) =>
          type?.type === "deterministic" ? type.counter : -1;
        previews.set(preview, {
          send: counterOf(outputConfig?.send),
          keep: counterOf(outputConfig?.keep),
          inputs: proofs.map((input) => input.secret),
        });
        return Promise.resolve(preview);
      },
      completeSwap: (preview) => {
        const swap = previews.get(preview);
        const { answer } = mint;
        if (swap === undefined) return Promise.reject(new Error("unknown"));
        if (answer instanceof Error) return Promise.reject(answer);
        if (answer === "drop") return Promise.reject(lostAnswer());
        if (signed.has(swap.send) || signed.has(swap.keep)) {
          return Promise.reject(
            new MintOperationError(11005, "outputs have already been signed"),
          );
        }
        const send = proof(4, `send@${swap.send}`);
        const keep = proof(2, `keep@${swap.keep}`);
        swap.inputs.forEach((secret) => spent.add(secret));
        signed.set(swap.send, send).set(swap.keep, keep);
        if (typeof answer === "object") return Promise.reject(answer.ranThen);
        return answer === "lose"
          ? Promise.reject(lostAnswer())
          : Promise.resolve({ keep: [keep], send: [send] });
      },
      restore: (start, count) => {
        restores.push([start, count]);
        const slots = [...signed.keys()].filter(
          (slot) => slot >= start && slot < start + count,
        );
        return Promise.resolve({
          proofs: slots.flatMap((slot) => signed.get(slot) ?? []),
          ...(slots.length === 0
            ? {}
            : { lastCounterWithSignature: Math.max(...slots) }),
        });
      },
      checkProofsStates: (proofs) =>
        proofs.some((entry) => silent.has(entry.secret))
          ? Promise.resolve([])
          : answerProofStates((secret) =>
              pending.has(secret)
                ? "PENDING"
                : spent.has(secret)
                  ? "SPENT"
                  : "UNSPENT",
            )(proofs),
    });
    return { mint, wallet };
  };

  /**
   * Runs `program` over shared fresh stores with `wallet`; `writes` records
   * every proof-store write batch.
   */
  const runSpends = <A, E>(
    wallet: LoadedWallet,
    program: (spends: {
      readonly swap: (secret: string) => Effect.Effect<SendResponse, unknown>;
      readonly select: Effect.Effect<SpendSelection, unknown>;
      readonly attempt: Effect.Effect<string | null>;
      readonly writes: ProofWrite[];
    }) => Effect.Effect<A, E, ProofStore>,
  ) => {
    const inspector = recordingInspector();
    const kv = makeInMemoryKeyValueStore();
    const writes: ProofWrite[] = [];
    return Effect.runPromiseExit(
      Effect.flatMap(ProofStore, (store) => {
        const proofStore = {
          ...store,
          write: (batch: ProofWrite) => {
            writes.push(batch);
            return store.write(batch);
          },
        };
        const context = {
          kv,
          proofStore,
          inspector: inspector.service,
          wallet,
        };
        return program({
          swap: (secret) =>
            swapProofsForAmount(
              { ...context, scope },
              {
                amount: Amount.make(4),
                proofs: toDomainProofs([proof(6, secret)]) ?? [],
                available: 6,
              },
            ),
          select: selectSpendableProofs({
            ...context,
            mint,
            unit: sat,
            reason: "test",
          }),
          attempt: Effect.map(
            kv.listKeys(LOST_SWAP_KEY_PREFIX),
            (keys) => keys[0] ?? null,
          ).pipe(
            Effect.flatMap((key) =>
              key === null ? Effect.succeed(null) : kv.get(key),
            ),
          ),
          writes,
        });
      }).pipe(Effect.provide(inMemoryProofStore)),
    ).then((exit) => ({ exit, events: inspector.events }));
  };

  it("returns a lost swap's outputs and spends its inputs in one write", async () => {
    const { mint: fake, wallet } = swapMint();
    const { exit, events } = await runSpends(wallet, (spends) =>
      Effect.gen(function* () {
        yield* seedProofs(mint, [proof(6, "in-1")]);
        fake.answer = "lose";
        const lost = yield* Effect.exit(spends.swap("in-1"));
        const recorded = yield* spends.attempt;
        spends.writes.length = 0;
        const { spendable } = yield* spends.select;
        return {
          lost,
          recorded,
          spendable,
          writes: [...spends.writes],
          proofs: yield* allProofs,
        };
      }),
    );

    assert(Exit.isSuccess(exit));
    const { lost, recorded, spendable, writes, proofs } = exit.value;
    expect(Exit.isFailure(lost)).toBe(true);
    expect(recorded).toContain("in-1");
    expect(fake.restores).toEqual([
      [1, 1],
      [65, 1],
    ]);
    expect(secretsOf(spendable)).toEqual(["keep@65", "send@1"]);
    expect(secretsOf(proofsIn(proofs, "spent"))).toEqual(["in-1"]);
    const [reclaim] = writes;
    expect(writes).toHaveLength(1);
    expect(reclaim?.insert?.map((row) => row.secret)).toEqual([
      "send@1",
      "keep@65",
    ]);
    expect(reclaim?.update).toHaveLength(1);
    expect(events).toContainEqual(
      expect.objectContaining({ _tag: "CounterAdvanced", to: 66 }),
    );
  });

  it("imports nothing another device signed in the slots of a swap that never ran", async () => {
    const { mint: fake, wallet } = swapMint();
    const { exit } = await runSpends(wallet, (spends) =>
      Effect.gen(function* () {
        yield* seedProofs(mint, [proof(6, "in-1")]);
        fake.answer = "drop";
        yield* Effect.exit(spends.swap("in-1"));
        // Another device on the seed spent the same synced proof and sent a
        // token from the slots this device had planned.
        fake.spent.add("in-1");
        fake.signed
          .set(1, proof(1, "other-token"))
          .set(65, proof(1, "other-keep"))
          .set(66, proof(4, "other-keep-2"));
        yield* spends.select;
        return { attempt: yield* spends.attempt, proofs: yield* allProofs };
      }),
    );

    assert(Exit.isSuccess(exit));
    const { attempt, proofs } = exit.value;
    expect(secretsOf(proofs)).toEqual(["in-1"]);
    expect(secretsOf(proofsIn(proofs, "spent"))).toEqual(["in-1"]);
    expect(attempt).toBeNull();
  });

  it.each([
    ["a rejection", new MintOperationError(11001, "Token already spent")],
    [
      "a collision on every attempt",
      new MintOperationError(11005, "outputs have already been signed"),
    ],
  ])(
    "drops the record of a swap the mint answered with %s",
    async (_, error) => {
      const { mint: fake, wallet } = swapMint();
      const { exit } = await runSpends(wallet, (spends) =>
        Effect.gen(function* () {
          fake.answer = error;
          const failed = yield* Effect.exit(spends.swap("in-1"));
          return { failed, attempt: yield* spends.attempt };
        }),
      );

      assert(Exit.isSuccess(exit));
      expect(Exit.isFailure(exit.value.failed)).toBe(true);
      expect(exit.value.attempt).toBeNull();
    },
  );

  it("reclaims at once a swap the mint ran but a retry answered as spent", async () => {
    const { mint: fake, wallet } = swapMint();
    const { exit } = await runSpends(wallet, (spends) =>
      Effect.gen(function* () {
        yield* seedProofs(mint, [proof(6, "in-1")]);
        fake.answer = {
          ranThen: new MintOperationError(11001, "Token already spent"),
        };
        const failed = yield* Effect.exit(spends.swap("in-1"));
        return {
          failed,
          attempt: yield* spends.attempt,
          proofs: yield* allProofs,
        };
      }),
    );

    assert(Exit.isSuccess(exit));
    const { failed, attempt, proofs } = exit.value;
    expect(Exit.isFailure(failed)).toBe(true);
    expect(attempt).toBeNull();
    expect(secretsOf(proofsIn(proofs, "available"))).toEqual([
      "keep@65",
      "send@1",
    ]);
    expect(secretsOf(proofsIn(proofs, "spent"))).toEqual(["in-1"]);
  });

  it.each([
    ["a truncated 200 body", new HttpResponseError("bad json", 200)],
    ["a 4xx without a cashu error", new HttpResponseError("bad request", 400)],
    ["an unblinding error", new Error("unblinding failed")],
  ])(
    "leaves a swap answered with %s to the next spend, which reclaims it once it ran",
    async (_, error) => {
      const { mint: fake, wallet } = swapMint();
      const { exit } = await runSpends(wallet, (spends) =>
        Effect.gen(function* () {
          yield* seedProofs(mint, [proof(6, "in-1")]);
          fake.answer = { ranThen: error };
          yield* Effect.exit(spends.swap("in-1"));
          const kept = yield* spends.attempt;
          yield* spends.select;
          return {
            kept,
            attempt: yield* spends.attempt,
            proofs: yield* allProofs,
          };
        }),
      );

      assert(Exit.isSuccess(exit));
      const { kept, attempt, proofs } = exit.value;
      expect(kept).toContain("in-1");
      expect(attempt).toBeNull();
      expect(secretsOf(proofsIn(proofs, "available"))).toEqual([
        "keep@65",
        "send@1",
      ]);
    },
  );

  it.each(["pending", "unanswered"] as const)(
    "keeps the record while an input is %s, without blocking other swaps",
    async (state) => {
      const { mint: fake, wallet } = swapMint();
      const unresolved = state === "pending" ? fake.pending : fake.silent;
      const { exit } = await runSpends(wallet, (spends) =>
        Effect.gen(function* () {
          yield* seedProofs(mint, [proof(6, "in-1")]);
          fake.answer = "lose";
          yield* Effect.exit(spends.swap("in-1"));
          unresolved.add("in-1");
          fake.answer = "answer";
          const other = yield* spends.swap("in-2");
          const kept = yield* spends.attempt;
          const before = yield* allProofs;
          unresolved.delete("in-1");
          yield* spends.select;
          return { other, kept, before, after: yield* allProofs };
        }),
      );

      assert(Exit.isSuccess(exit));
      const { other, kept, before, after } = exit.value;
      expect(secretsOf(other.send)).toEqual(["send@66"]);
      expect(kept).toContain("in-1");
      expect(secretsOf(proofsIn(before, "available"))).toEqual(["in-1"]);
      expect(secretsOf(proofsIn(after, "available"))).toEqual([
        "keep@65",
        "send@1",
      ]);
      expect(secretsOf(proofsIn(after, "spent"))).toEqual(["in-1"]);
    },
  );
});
