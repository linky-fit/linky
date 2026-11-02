import { Effect, Exit } from "effect";
import { CurrencyUnit, MintUrl } from "../domain/primitives";
import { ProofStore } from "../ports/ProofStore";
import type { ProofWrite } from "../ports/ProofStore";
import { inMemoryProofStore } from "../ports/inMemoryProofStore";
import { fakeWallet, KEYSET_HEX, proof } from "../testing/fakeWallet";
import type { ProofStateName } from "../testing/fakeWallet";
import { recordingInspector } from "../testing/inspector";
import {
  allProofs,
  proofsIn,
  secretsOf,
  seedProofs,
} from "../testing/inventory";
import { toNewProofs } from "./proofs";
import { selectSpendableProofs, settleSwap } from "./spend";
import type { SpendContext } from "./spend";

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
