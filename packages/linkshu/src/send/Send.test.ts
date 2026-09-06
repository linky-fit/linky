import type { Proof as CashuProof, SendResponse } from "@cashu/cashu-ts";
import { getEncodedToken, MintOperationError } from "@cashu/cashu-ts";
import { Effect, Exit, Layer } from "effect";
import {
  Amount as SendAmount,
  CurrencyUnit,
  KeysetId,
  MintUrl,
} from "../domain/primitives";
import { deterministicCounterKey } from "../internal/counters";
import { WalletInstances } from "../mint/internal/WalletInstances";
import type { LoadedWallet } from "../mint/internal/WalletInstances";
import { deterministicIdTokenStore } from "../testing/deterministicIdTokenStore";
import { inMemoryKeyValueStore } from "../ports/inMemoryKeyValueStore";
import { inMemoryTokenStore } from "../ports/inMemoryTokenStore";
import { KeyValueStore } from "../ports/KeyValueStore";
import { TokenStore } from "../ports/TokenStore";
import type { StoredTokenRow } from "../ports/TokenStore";
import { fakeWallet, KEYSET_HEX, proof } from "../testing/fakeWallet";
import { recordingInspector } from "../testing/inspector";
import { seedRow } from "../testing/rows";
import { parseTokenText } from "../token/codec";
import { encodeCashuProofs } from "../token/internal/cashuProofs";
import type { TokenState } from "../token/domain";
import { SendDraft } from "./domain";
import { Send } from "./Send";

const mint = MintUrl.make("https://mint.example");
const counterKey = deterministicCounterKey({
  mint,
  unit: CurrencyUnit.make("sat"),
  keysetId: KeysetId.make(KEYSET_HEX),
});

// Row A (4+2) and row B (8): 14 sats available at the mint under test.
const tokenA = getEncodedToken({
  mint,
  unit: "sat",
  proofs: [proof(4, "src-a1"), proof(2, "src-a2")],
});
const tokenB = getEncodedToken({
  mint,
  unit: "sat",
  proofs: [proof(8, "src-b1")],
});
const otherMintToken = getEncodedToken({
  mint: "https://other.example",
  unit: "sat",
  proofs: [proof(16, "src-o1")],
});

const outputsAlreadySigned = () =>
  new MintOperationError(11005, "outputs have already been signed before");

interface FakeWalletArgs {
  send?: (call: SendCall) => Promise<SendResponse>;
  /** NUT-07 state per proof secret; defaults to UNSPENT. */
  stateOf?: (secret: string) => "UNSPENT" | "PENDING" | "SPENT";
  checkStatesError?: unknown;
  restore?: () => Promise<{
    proofs: CashuProof[];
    lastCounterWithSignature?: number;
  }>;
}

interface SendCall {
  readonly amount: number;
  readonly secrets: ReadonlyArray<string>;
  readonly sendCounter: number;
  readonly keepCounter: number;
}

const makeWallet = (args: FakeWalletArgs) => {
  const sendCalls: SendCall[] = [];
  const restoreCalls: Array<{ start: number; count: number }> = [];
  const wallet = fakeWallet({
    keysetId: KEYSET_HEX,
    checkProofsStates: (proofs) =>
      args.checkStatesError !== undefined
        ? Promise.reject(args.checkStatesError)
        : Promise.resolve(
            proofs.map((entry) => ({
              Y: entry.secret,
              state: args.stateOf?.(entry.secret) ?? "UNSPENT",
              witness: null,
            })),
          ),
    send: (amount, proofs, _config, outputConfig) => {
      const call: SendCall = {
        amount: typeof amount === "number" ? amount : -1,
        secrets: proofs.map((entry) => entry.secret),
        sendCounter:
          outputConfig?.send.type === "deterministic"
            ? outputConfig.send.counter
            : -1,
        keepCounter:
          outputConfig?.keep?.type === "deterministic"
            ? outputConfig.keep.counter
            : -1,
      };
      sendCalls.push(call);
      return args.send
        ? args.send(call)
        : Promise.reject(new Error("send not stubbed"));
    },
    restore: (start, count) => {
      restoreCalls.push({ start, count });
      return args.restore
        ? args.restore()
        : Promise.reject(new Error("restore unavailable"));
    },
  });
  return { wallet, sendCalls, restoreCalls };
};

const makeHarness = (
  wallet: LoadedWallet,
  tokenStore: Layer.Layer<TokenStore> = inMemoryTokenStore,
) => {
  const inspector = recordingInspector();
  const layer = Send.DefaultWithoutDependencies.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.succeed(
          WalletInstances,
          WalletInstances.make({ get: () => Effect.succeed(wallet) }),
        ),
        inMemoryKeyValueStore,
        tokenStore,
        inspector.layer,
      ),
    ),
  );
  const run = <A, E>(
    program: Effect.Effect<
      A,
      E,
      Send | TokenStore | KeyValueStore | WalletInstances
    >,
  ) => Effect.runPromiseExit(program.pipe(Effect.provide(layer)));
  return { run, events: inspector.events };
};

const sendAndInspect = (draft: SendDraft, seeds: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    yield* Effect.forEach(seeds, (tokenText) => seedRow(tokenText));
    const send = yield* Send;
    const kv = yield* KeyValueStore;
    const tokenStore = yield* TokenStore;
    const receipt = yield* Effect.either(send.send(draft));
    return {
      receipt,
      rows: yield* tokenStore.loadAll,
      counter: yield* kv.get(counterKey),
    };
  });

const rowByState = (
  rows: ReadonlyArray<StoredTokenRow>,
  state: TokenState,
): StoredTokenRow | undefined => rows.find((row) => row.state === state);

const draft = (amount: number, produceAs: "issued" | "pending" = "issued") =>
  new SendDraft({ mint, amount: SendAmount.make(amount), produceAs });

describe("Send.send", () => {
  it("swaps with disjoint counter blocks, persists change and send rows, removes sources", async () => {
    // keep mixes passthrough (a1) with one fresh change output (k1).
    const { wallet, sendCalls } = makeWallet({
      send: () =>
        Promise.resolve({
          keep: [proof(4, "src-a1"), proof(4, "k1")],
          send: [proof(4, "s1"), proof(1, "s2")],
        }),
    });
    const { run, events } = makeHarness(wallet);

    const exit = await run(
      sendAndInspect(draft(5), [tokenA, tokenB, otherMintToken]),
    );
    assert(Exit.isSuccess(exit));
    const { receipt, rows, counter } = exit.value;

    assert(receipt._tag === "Right");
    expect(receipt.right.mint).toBe(mint);
    expect(receipt.right.unit).toBe("sat");
    expect(receipt.right.amount).toBe(5);
    expect(receipt.right.changeAmount).toBe(8);
    // 14 offered - 5 sent - 8 kept.
    expect(receipt.right.feePaid).toBe(1);
    expect(parseTokenText(receipt.right.tokenText)?.amount).toBe(5);

    expect(sendCalls).toEqual([
      {
        amount: 5,
        secrets: ["src-a1", "src-a2", "src-b1"],
        sendCounter: 1,
        keepCounter: 65,
      },
    ]);
    // Send block (64) fully burned + 1 fresh keep output.
    expect(counter).toBe("66");

    // Sources for the mint are gone; the foreign-mint row is untouched.
    expect(rows).toHaveLength(3);
    const untouched = rows.find((row) => row.tokenText === otherMintToken);
    expect(untouched?.state).toBe("accepted");
    const freshChange = rows.find(
      (row) => row.state === "accepted" && row.tokenText !== otherMintToken,
    );
    expect(parseTokenText(freshChange?.tokenText ?? "")?.amount).toBe(8);
    const sendRow = rowByState(rows, "issued");
    expect(sendRow?.tokenText).toBe(receipt.right.tokenText);
    expect(sendRow?.id).toBe(receipt.right.rowId);

    expect(events.map((event) => event._tag)).toEqual([
      "CounterAdvanced",
      "TokenLifecycleChanged",
      "TokenLifecycleChanged",
      "OperationSucceeded",
    ]);
    expect(events[0]).toMatchObject({ from: 1, to: 66, reason: "used" });
    expect(events[1]).toMatchObject({
      from: null,
      to: "accepted",
      reason: "send-change",
    });
    expect(events[2]).toMatchObject({
      from: null,
      to: "issued",
      reason: "send",
    });
    expect(events[3]).toMatchObject({
      name: "send.send",
      params: { mint, amount: 5, produceAs: "issued" },
      result: { amount: 5, changeAmount: 8, feePaid: 1 },
    });
    // No key material: neither token text nor proof secrets in any event.
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("cashu");
    expect(serialized).not.toContain("s1");
    expect(serialized).not.toContain("src-a1");
  });

  it("produces the send row in the drafted pending state", async () => {
    const { wallet } = makeWallet({
      send: () =>
        Promise.resolve({ keep: [], send: [proof(4, "s1"), proof(2, "s2")] }),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(sendAndInspect(draft(6, "pending"), [tokenA]));
    assert(Exit.isSuccess(exit));
    expect(exit.value.receipt._tag).toBe("Right");
    // Exact spend: no change row, only the pending send row remains.
    expect(exit.value.rows).toHaveLength(1);
    expect(exit.value.rows[0]?.state).toBe("pending");
  });

  it("excludes NUT-07 spent proofs and marks fully spent rows as error", async () => {
    const spentToken = getEncodedToken({
      mint,
      unit: "sat",
      proofs: [proof(3, "src-z1")],
    });
    const { wallet, sendCalls } = makeWallet({
      stateOf: (secret) =>
        secret === "src-a2" || secret === "src-z1" ? "SPENT" : "UNSPENT",
      send: () => Promise.resolve({ keep: [], send: [proof(3, "s1")] }),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(sendAndInspect(draft(3), [tokenA, spentToken]));
    assert(Exit.isSuccess(exit));
    const { receipt, rows } = exit.value;

    assert(receipt._tag === "Right");
    // Only the unspent a1 proof was offered; available was 4, fee 4-3-0.
    expect(sendCalls[0]?.secrets).toEqual(["src-a1"]);
    expect(receipt.right.feePaid).toBe(1);
    expect(receipt.right.changeAmount).toBe(0);

    const errorRow = rowByState(rows, "error");
    expect(errorRow?.tokenText).toBe(spentToken);
    expect(JSON.parse(errorRow?.error ?? "")).toMatchObject({
      _tag: "TokenAlreadySpent",
      mint,
    });
    expect(rows).toHaveLength(2); // error row + issued send row
  });

  it("fails with InsufficientFunds before calling the mint", async () => {
    const { wallet, sendCalls } = makeWallet({});
    const { run } = makeHarness(wallet);

    const exit = await run(sendAndInspect(draft(15), [tokenA, tokenB]));
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Left");
    expect(exit.value.receipt.left).toMatchObject({
      _tag: "InsufficientFunds",
      required: 15,
      available: 14,
    });
    expect(sendCalls).toEqual([]);
    expect(exit.value.rows.every((row) => row.state === "accepted")).toBe(true);
  });

  it("maps the mint's fee-inclusive shortfall to InsufficientFunds", async () => {
    const { wallet } = makeWallet({
      send: () =>
        Promise.reject(new Error("Not enough funds available for swap")),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(sendAndInspect(draft(14), [tokenA, tokenB]));
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Left");
    expect(exit.value.receipt.left).toMatchObject({
      _tag: "InsufficientFunds",
      required: 14,
      available: 14,
    });
    expect(exit.value.rows.every((row) => row.state === "accepted")).toBe(true);
  });

  it("surfaces transient failures without touching any row", async () => {
    const { wallet } = makeWallet({
      send: () => Promise.reject(new TypeError("fetch failed")),
    });
    const { run, events } = makeHarness(wallet);

    const exit = await run(sendAndInspect(draft(5), [tokenA, tokenB]));
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Left");
    expect(exit.value.receipt.left._tag).toBe("MintUnreachable");
    expect(exit.value.rows.every((row) => row.state === "accepted")).toBe(true);
    expect(events.map((event) => event._tag)).toEqual(["OperationFailed"]);
  });

  it("classifies a NUT-07 check failure as MintUnreachable", async () => {
    const { wallet, sendCalls } = makeWallet({
      checkStatesError: new TypeError("fetch failed"),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(sendAndInspect(draft(5), [tokenA]));
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Left");
    expect(exit.value.receipt.left._tag).toBe("MintUnreachable");
    expect(sendCalls).toEqual([]);
  });

  it("surfaces a definitive rejection as MintRejected and leaves rows intact", async () => {
    const { wallet } = makeWallet({
      send: () =>
        Promise.reject(new MintOperationError(20003, "keyset inactive")),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(sendAndInspect(draft(5), [tokenA, tokenB]));
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Left");
    expect(exit.value.receipt.left).toMatchObject({
      _tag: "MintRejected",
      code: 20003,
    });
    expect(exit.value.rows.every((row) => row.state === "accepted")).toBe(true);
  });

  it.each([
    outputsAlreadySigned(),
    new MintOperationError(11008, "Duplicate outputs"),
    new Error("Duplicate outputs"),
  ])(
    "recovers a stale counter via NUT-09 restore and retries: %s",
    async (collision) => {
      const { wallet, sendCalls, restoreCalls } = makeWallet({
        send: (call) =>
          call.sendCounter < 40
            ? Promise.reject(collision)
            : Promise.resolve({
                keep: [proof(9, "k1")],
                send: [proof(4, "s1")],
              }),
        restore: () =>
          Promise.resolve({ proofs: [], lastCounterWithSignature: 39 }),
      });
      const { run, events } = makeHarness(wallet);

      const exit = await run(sendAndInspect(draft(4), [tokenA, tokenB]));
      assert(Exit.isSuccess(exit));
      expect(exit.value.receipt._tag).toBe("Right");
      expect(sendCalls.map((call) => call.sendCounter)).toEqual([1, 40]);
      expect(sendCalls[1]?.keepCounter).toBe(104);
      expect(restoreCalls).toEqual([{ start: 1, count: 100 }]);
      expect(exit.value.counter).toBe("105"); // 40 + 64 + 1 fresh keep output

      const counterEvents = events.filter(
        (event) => event._tag === "CounterAdvanced",
      );
      expect(counterEvents).toEqual([
        expect.objectContaining({
          from: 1,
          to: 40,
          reason: "collision-recovery",
        }),
        expect.objectContaining({ from: 40, to: 105, reason: "used" }),
      ]);
    },
  );

  it("bounds duplicate-output retries and preserves source rows on rejection", async () => {
    const { wallet, sendCalls, restoreCalls } = makeWallet({
      send: () =>
        Promise.reject(new MintOperationError(11008, "Duplicate outputs")),
      restore: () => Promise.resolve({ proofs: [] }),
    });
    const { run } = makeHarness(wallet);
    const exit = await run(sendAndInspect(draft(4), [tokenA, tokenB]));
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Left");
    expect(exit.value.receipt.left).toMatchObject({
      _tag: "MintRejected",
      code: 11008,
    });
    expect(sendCalls.map((call) => call.sendCounter)).toEqual([
      1, 129, 257, 385, 513,
    ]);
    expect(restoreCalls).toHaveLength(5);
    expect(exit.value.rows.every((row) => row.state === "accepted")).toBe(true);
  });

  it("offers proofs shared by twin rows only once and consumes both rows", async () => {
    const { wallet, sendCalls } = makeWallet({
      send: () =>
        Promise.resolve({ keep: [], send: [proof(4, "s1"), proof(1, "s2")] }),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(sendAndInspect(draft(5), [tokenA, tokenA]));
    assert(Exit.isSuccess(exit));
    expect(exit.value.receipt._tag).toBe("Right");
    expect(sendCalls[0]?.secrets).toEqual(["src-a1", "src-a2"]);
    // Both twin rows consumed; only the issued send row remains.
    expect(exit.value.rows).toHaveLength(1);
    expect(exit.value.rows[0]?.state).toBe("issued");
  });

  it("spares the source row whose id the change insert reused (deterministic-id store)", async () => {
    // A fully-unselected source row passes through the swap's keep side
    // unchanged, so the change row re-encodes byte-identically to it — a
    // store deriving ids from `originalTokenText` reuses the source row's id.
    const passthrough = [proof(4, "src-a1"), proof(2, "src-a2")];
    const collisionText = encodeCashuProofs({
      mint,
      unit: CurrencyUnit.make("sat"),
      memo: null,
      proofs: passthrough,
    })?.tokenText;
    expect(collisionText).toBeDefined();
    if (collisionText === undefined) return;

    const { wallet } = makeWallet({
      send: () =>
        Promise.resolve({ keep: passthrough, send: [proof(8, "s1")] }),
    });
    const { run } = makeHarness(wallet, deterministicIdTokenStore);

    const exit = await run(sendAndInspect(draft(8), [collisionText, tokenB]));
    assert(Exit.isSuccess(exit));
    const { receipt, rows } = exit.value;

    assert(receipt._tag === "Right");
    expect(receipt.right.changeAmount).toBe(6);
    expect(rows).toHaveLength(2);
    // The change landed on the source row's own id and survived the removal.
    const changeRow = rows.find((row) => row.tokenText === collisionText);
    expect(changeRow?.state).toBe("accepted");
    const sendRow = rowByState(rows, "issued");
    expect(sendRow?.id).toBe(receipt.right.rowId);
    expect(rows.find((row) => row.tokenText === tokenB)).toBeUndefined();
  });

  it("starts the swap from the persisted counter", async () => {
    const { wallet, sendCalls } = makeWallet({
      send: () => Promise.resolve({ keep: [], send: [proof(4, "s1")] }),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(
      Effect.gen(function* () {
        const kv = yield* KeyValueStore;
        yield* kv.set(counterKey, "7");
        yield* seedRow(tokenA);
        const send = yield* Send;
        yield* send.send(draft(4));
        return yield* kv.get(counterKey);
      }),
    );
    expect(exit).toEqual(Exit.succeed("71")); // 7 + 64 send block, no change
    expect(sendCalls[0]).toMatchObject({ sendCounter: 7, keepCounter: 71 });
  });
});
