import type { Proof as CashuProof } from "@cashu/cashu-ts";
import {
  getDecodedToken,
  Keyset,
  MintOperationError,
  RateLimitError,
} from "@cashu/cashu-ts";
import { Effect, Exit, Layer } from "effect";
import { MintUnreachable } from "../domain/errors";
import { CurrencyUnit, KeysetId, MintUrl } from "../domain/primitives";
import { deterministicCounterKey } from "../internal/counters";
import { seenMintKey, WalletInstances } from "../mint/internal/WalletInstances";
import { inMemoryKeyValueStore } from "../ports/inMemoryKeyValueStore";
import { inMemoryOperationStore } from "../ports/inMemoryOperationStore";
import { inMemoryProofStore } from "../ports/inMemoryProofStore";
import { KeyValueStore } from "../ports/KeyValueStore";
import { ProofStore } from "../ports/ProofStore";
import type { ProofState } from "../ports/ProofStore";
import { fakeWallet, KEYSET_HEX, proof } from "../testing/fakeWallet";
import { recordingInspector } from "../testing/inspector";
import { amountIn, secretsOf, seedProofs } from "../testing/inventory";
import type { RestoreProgress } from "./domain";
import { RestoreDraft, SkippedKeyset } from "./domain";
import { restoreCursorKey, seenKeysetKey } from "./internal/restoreState";
import { Restore } from "./Restore";

const mint = MintUrl.make("https://mint.example");
const sat = CurrencyUnit.make("sat");
const keysetHex = KeysetId.make(KEYSET_HEX);
const otherKeysetHex = KeysetId.make("009a1f293253e41f");

const scope = { mint, unit: sat, keysetId: keysetHex };
const counterKey = deterministicCounterKey(scope);
const cursorKey = restoreCursorKey(scope);

/** A blinded slot the mint has a signature for. */
interface SignedSlot {
  readonly slot: number;
  readonly proof: CashuProof;
}

interface RestoreCall {
  readonly start: number;
  readonly keysetId: string;
}

interface HarnessArgs {
  signed?: ReadonlyArray<SignedSlot>;
  keysets?: ReadonlyArray<Keyset>;
  keysetsForMint?: (mint: MintUrl) => ReadonlyArray<Keyset>;
  unreachableMints?: ReadonlyArray<MintUrl>;
  stateOf?: (secret: string) => "UNSPENT" | "PENDING" | "SPENT";
  restoreErrorFor?: (keysetId: string) => unknown;
  walletUnreachable?: boolean;
  receive?: (text: string) => Promise<CashuProof[]>;
}

const makeHarness = (args: HarnessArgs) => {
  const restoreCalls: Array<RestoreCall> = [];
  const inspector = recordingInspector();
  const signed = args.signed ?? [];

  const wallet = (requested: MintUrl) =>
    fakeWallet({
      ...(args.receive === undefined ? {} : { receive: args.receive }),
      keysetId: keysetHex,
      keyChain: {
        getKeysets: () => [
          ...(args.keysetsForMint?.(requested) ??
            args.keysets ?? [new Keyset(keysetHex, "sat", true, 0)]),
        ],
      },
      checkProofsStates: (proofs) =>
        Promise.resolve(
          proofs.map((entry) => ({
            Y: entry.secret ?? "",
            state: args.stateOf?.(entry.secret ?? "") ?? "UNSPENT",
            witness: null,
          })),
        ),
      batchRestore: (_gapLimit, _batchSize, counter = 0, keysetId = "") => {
        restoreCalls.push({ start: counter, keysetId });
        const failure = args.restoreErrorFor?.(keysetId);
        if (failure !== undefined) {
          return Promise.reject(failure);
        }
        const found = signed.filter((entry) => entry.slot >= counter);
        return Promise.resolve({
          proofs: found.map((entry) => entry.proof),
          ...(found.length > 0
            ? {
                lastCounterWithSignature: Math.max(
                  ...found.map((entry) => entry.slot),
                ),
              }
            : {}),
        });
      },
    });

  const layer = Restore.DefaultWithoutDependencies.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.succeed(
          WalletInstances,
          WalletInstances.make({
            get: (requested) =>
              args.walletUnreachable === true ||
              args.unreachableMints?.includes(requested)
                ? Effect.fail(
                    new MintUnreachable({ mint: requested, detail: null }),
                  )
                : Effect.succeed(wallet(requested)),
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
    program: Effect.Effect<A, E, Restore | ProofStore | KeyValueStore>,
  ) => Effect.runPromiseExit(program.pipe(Effect.provide(layer)));

  return { run, restoreCalls, events: inspector.events };
};

const restoreAt = (mints: ReadonlyArray<MintUrl> = [mint]) =>
  Effect.gen(function* () {
    const restore = yield* Restore;
    const report = yield* restore.restore(new RestoreDraft({ mints }));
    const kv = yield* KeyValueStore;
    return {
      report,
      proofs: yield* (yield* ProofStore).loadAll,
      counter: yield* kv.get(counterKey),
      cursor: yield* kv.get(cursorKey),
    };
  });

describe("Restore.restore", () => {
  it.each([false, true])(
    "reports a fixed total and completes every keyset attempt, including failures: %s",
    async (fail) => {
      const progress: RestoreProgress[] = [];
      const { run, restoreCalls } = makeHarness({
        keysetsForMint: (requested) =>
          requested === mint
            ? [
                new Keyset(keysetHex, "sat", true, 0),
                new Keyset(otherKeysetHex, "sat", false, 0),
              ]
            : [new Keyset(keysetHex, "sat", true, 0)],
        ...(fail
          ? { restoreErrorFor: () => new Error("mint rejected keyset") }
          : {}),
      });
      const mints = [mint, MintUrl.make("https://second.example")];
      const exit = await run(
        Effect.gen(function* () {
          return yield* (yield* Restore).restore(
            new RestoreDraft({ mints }),
            (update) => {
              if (update.phase === "scanning" && update.completedKeysets === 0)
                expect(restoreCalls).toHaveLength(0);
              progress.push(update);
            },
          );
        }),
      );
      assert(Exit.isSuccess(exit));
      expect(progress).toEqual([
        {
          phase: "preparing",
          completedKeysets: 0,
          totalKeysets: 0,
          totalMints: 2,
        },
        ...[0, 1, 2, 3].map((completedKeysets) => ({
          phase: "scanning",
          completedKeysets,
          totalKeysets: 3,
          totalMints: 2,
        })),
      ]);
      expect(exit.value.unavailableMints).toEqual(fail ? mints : []);
      expect(exit.value.scannedMints).toEqual(fail ? [] : mints);
      expect(exit.value.skippedKeysets).toEqual([]);
    },
  );

  it("keeps a mint scanned when it refuses one keyset, and names the keyset", async () => {
    const { run } = makeHarness({
      keysets: [
        new Keyset(keysetHex, "sat", true, 0),
        new Keyset(otherKeysetHex, "sat", false, 0),
      ],
      signed: [{ slot: 3, proof: proof(4, "r1") }],
      restoreErrorFor: (keysetId) =>
        keysetId === otherKeysetHex
          ? new Error(`Keyset verification failed for ID ${otherKeysetHex}`)
          : undefined,
    });

    const exit = await run(restoreAt());

    assert(Exit.isSuccess(exit));
    const { report } = exit.value;
    expect(report.scannedMints).toEqual([mint]);
    expect(report.unavailableMints).toEqual([]);
    expect(report.restoredAmount).toBe(4);
    expect(report.skippedKeysets).toHaveLength(1);
    expect(report.skippedKeysets[0]).toMatchObject({
      mint,
      keysetId: otherKeysetHex,
    });
    expect(report.skippedKeysets[0]?.detail).toContain(
      "Keyset verification failed",
    );
  });

  it("keeps a mint scanned when it rejects one keyset with a NUT error code", async () => {
    const { run } = makeHarness({
      keysets: [
        new Keyset(keysetHex, "sat", true, 0),
        new Keyset(otherKeysetHex, "sat", false, 0),
      ],
      signed: [{ slot: 3, proof: proof(4, "r1") }],
      restoreErrorFor: (keysetId) =>
        keysetId === otherKeysetHex
          ? new MintOperationError(12001, "keyset not known")
          : undefined,
    });

    const exit = await run(restoreAt());

    assert(Exit.isSuccess(exit));
    const { report } = exit.value;
    expect(report.scannedMints).toEqual([mint]);
    expect(report.restoredAmount).toBe(4);
    expect(report.skippedKeysets).toEqual([
      new SkippedKeyset({
        mint,
        keysetId: otherKeysetHex,
        detail: "MintOperationError: keyset not known",
      }),
    ]);
  });

  it("still reports the mint unavailable when it rate-limits a keyset scan", async () => {
    const { run } = makeHarness({
      keysets: [
        new Keyset(keysetHex, "sat", true, 0),
        new Keyset(otherKeysetHex, "sat", false, 0),
      ],
      signed: [{ slot: 3, proof: proof(4, "r1") }],
      restoreErrorFor: (keysetId) =>
        keysetId === otherKeysetHex
          ? new RateLimitError("429 Too Many Requests", 1000)
          : undefined,
    });

    const exit = await run(restoreAt());

    assert(Exit.isSuccess(exit));
    expect(exit.value.report.unavailableMints).toEqual([mint]);
    expect(exit.value.report.scannedMints).toEqual([]);
    expect(exit.value.report.skippedKeysets).toEqual([]);
  });

  it("still reports the mint unavailable when a keyset scan cannot reach it", async () => {
    const { run } = makeHarness({
      keysets: [
        new Keyset(keysetHex, "sat", true, 0),
        new Keyset(otherKeysetHex, "sat", false, 0),
      ],
      signed: [{ slot: 3, proof: proof(4, "r1") }],
      restoreErrorFor: (keysetId) =>
        keysetId === otherKeysetHex ? new TypeError("fetch failed") : undefined,
    });

    const exit = await run(restoreAt());

    assert(Exit.isSuccess(exit));
    expect(exit.value.report.unavailableMints).toEqual([mint]);
    expect(exit.value.report.scannedMints).toEqual([]);
    expect(exit.value.report.skippedKeysets).toEqual([]);
  });

  it("continues across mints when one cannot load and counts only discovered keysets", async () => {
    const offlineMint = MintUrl.make("https://offline.example");
    const progress: RestoreProgress[] = [];
    const { run } = makeHarness({ unreachableMints: [offlineMint] });
    const exit = await run(
      Effect.gen(function* () {
        return yield* (yield* Restore).restore(
          new RestoreDraft({ mints: [offlineMint, mint, mint] }),
          (update) => progress.push(update),
        );
      }),
    );
    assert(Exit.isSuccess(exit));
    expect(exit.value.unavailableMints).toEqual([offlineMint]);
    expect(exit.value.scannedMints).toEqual([mint]);
    expect(progress).toEqual([
      {
        phase: "preparing",
        completedKeysets: 0,
        totalKeysets: 0,
        totalMints: 2,
      },
      {
        phase: "scanning",
        completedKeysets: 0,
        totalKeysets: 1,
        totalMints: 2,
      },
      {
        phase: "scanning",
        completedKeysets: 1,
        totalKeysets: 1,
        totalMints: 2,
      },
    ]);
  });

  it("reports no scan total when mint discovery fails", async () => {
    const progress: RestoreProgress[] = [];
    const { run } = makeHarness({ walletUnreachable: true });
    const exit = await run(
      Effect.gen(function* () {
        return yield* (yield* Restore).restore(
          new RestoreDraft({ mints: [mint] }),
          (update) => progress.push(update),
        );
      }),
    );
    assert(Exit.isSuccess(exit));
    expect(exit.value.unavailableMints).toEqual([mint]);
    expect(progress.at(-1)).toEqual({
      phase: "scanning",
      completedKeysets: 0,
      totalKeysets: 0,
      totalMints: 1,
    });
  });

  it("recovers signed proofs as available and moves cursor and counter past them", async () => {
    const { run, restoreCalls } = makeHarness({
      signed: [
        { slot: 3, proof: proof(4, "r1") },
        { slot: 5, proof: proof(8, "r2") },
      ],
    });

    const exit = await run(restoreAt());

    assert(Exit.isSuccess(exit));
    const { report, proofs, counter, cursor } = exit.value;

    expect(report.restoredAmount).toBe(12);
    expect(report.restoredProofs).toBe(2);
    expect(report.scannedMints).toEqual([mint]);
    expect(report.unavailableMints).toEqual([]);

    expect(secretsOf(proofs)).toEqual(["r1", "r2"]);
    expect(amountIn(proofs, "available")).toBe(12);
    expect(proofs.every((entry) => entry.mint === mint)).toBe(true);

    // Both positions move past the last signature the mint reported.
    expect(cursor).toBe("6");
    expect(counter).toBe("6");
    expect(restoreCalls).toEqual([{ start: 0, keysetId: keysetHex }]);
  });

  it("is idempotent: a second run finds the same signatures and stores nothing", async () => {
    const { run } = makeHarness({
      signed: [{ slot: 3, proof: proof(4, "r1") }],
    });

    const exit = await run(
      Effect.gen(function* () {
        const first = yield* restoreAt();
        const second = yield* restoreAt();
        return { first, second };
      }),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.first.report.restoredAmount).toBe(4);
    expect(exit.value.second.report.restoredAmount).toBe(0);
    expect(exit.value.second.report.restoredProofs).toBe(0);
    expect(exit.value.second.proofs).toHaveLength(1);
    expect(exit.value.second.cursor).toBe("4");
  });

  it("imports only the proofs the mint reports unspent", async () => {
    const { run } = makeHarness({
      signed: [
        { slot: 1, proof: proof(4, "spent") },
        { slot: 2, proof: proof(8, "live") },
        { slot: 3, proof: proof(16, "pending") },
      ],
      stateOf: (secret) =>
        secret === "spent"
          ? "SPENT"
          : secret === "pending"
            ? "PENDING"
            : "UNSPENT",
    });

    const exit = await run(restoreAt());

    assert(Exit.isSuccess(exit));
    expect(exit.value.report.restoredAmount).toBe(8);
    expect(secretsOf(exit.value.proofs)).toEqual(["live"]);
    expect(exit.value.proofs[0]?.state).toBe("available");
  });

  it.each([
    "available",
    "held",
    "handedOut",
    "externalized",
    "spent",
  ] as const satisfies ReadonlyArray<ProofState>)(
    "skips a signed proof already stored as %s",
    async (state) => {
      const { run } = makeHarness({
        signed: [
          { slot: 1, proof: proof(4, "r1") },
          { slot: 2, proof: proof(8, "r2") },
        ],
      });

      const exit = await run(
        Effect.gen(function* () {
          yield* seedProofs(mint, [proof(4, "r1")], state);
          return yield* restoreAt();
        }),
      );

      assert(Exit.isSuccess(exit));
      expect(exit.value.report.restoredAmount).toBe(8);
      expect(exit.value.report.restoredProofs).toBe(1);
      expect(
        exit.value.proofs.find((entry) => entry.secret === "r1")?.state,
      ).toBe(state);
    },
  );

  it("reports an unreachable mint instead of failing", async () => {
    const { run } = makeHarness({
      signed: [{ slot: 1, proof: proof(4, "r1") }],
      restoreErrorFor: () => new TypeError("fetch failed"),
    });

    const exit = await run(restoreAt());

    assert(Exit.isSuccess(exit));
    expect(exit.value.report).toMatchObject({
      restoredAmount: 0,
      scannedMints: [],
      unavailableMints: [mint],
    });
    expect(exit.value.proofs).toEqual([]);
    expect(exit.value.cursor).toBeNull();
  });

  it("reports a mint whose wallet will not load", async () => {
    const { run, restoreCalls } = makeHarness({ walletUnreachable: true });

    const exit = await run(restoreAt());

    assert(Exit.isSuccess(exit));
    expect(exit.value.report.unavailableMints).toEqual([mint]);
    expect(restoreCalls).toEqual([]);
  });

  it("scans every keyset of the mint and remembers them for later runs", async () => {
    const { run, restoreCalls } = makeHarness({
      keysets: [
        new Keyset(keysetHex, "sat", true, 0),
        new Keyset(otherKeysetHex, "sat", false, 0),
        new Keyset("00ffffffffffffff", "usd", true, 0),
      ],
    });

    const exit = await run(
      Effect.gen(function* () {
        const result = yield* restoreAt();
        const kv = yield* KeyValueStore;
        return {
          result,
          seen: yield* kv.get(seenKeysetKey(mint, sat, otherKeysetHex)),
        };
      }),
    );

    assert(Exit.isSuccess(exit));
    // Inactive keysets still hold old proofs; other units are not ours.
    expect(restoreCalls.map((call) => call.keysetId)).toEqual([
      keysetHex,
      otherKeysetHex,
    ]);
    expect(exit.value.seen).toBe(otherKeysetHex);
  });

  it("defaults to the mints the wallet already knows", async () => {
    const { run, restoreCalls } = makeHarness({
      signed: [{ slot: 1, proof: proof(4, "r1") }],
    });

    const exit = await run(
      Effect.gen(function* () {
        yield* (yield* KeyValueStore).set(seenMintKey(mint), mint);
        const restore = yield* Restore;
        return yield* restore.restore(new RestoreDraft({}));
      }),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.scannedMints).toEqual([mint]);
    expect(exit.value.restoredAmount).toBe(4);
    expect(restoreCalls).toHaveLength(1);
  });

  it("emits the proof batch and the counter move, without proof secrets", async () => {
    const { run, events } = makeHarness({
      signed: [{ slot: 2, proof: proof(4, "r1") }],
    });

    await run(restoreAt());

    expect(events.map((event) => event._tag)).toEqual([
      "ProofsChanged",
      "CounterAdvanced",
      "OperationSucceeded",
    ]);
    expect(events[0]).toMatchObject({
      mint,
      count: 1,
      amount: 4,
      from: null,
      to: "available",
      reason: "restore",
    });
    expect(events[1]).toMatchObject({ from: 1, to: 3, reason: "restore" });
    expect(events[2]).toMatchObject({ name: "restore.restore" });
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("r1");
    expect(serialized).not.toContain("cashu");
  });
});

describe("Restore.restoreAndReclaim", () => {
  it("swaps only newly discovered proofs, preserves every known state, and does not swap them twice", async () => {
    const received: string[] = [];
    const progress: RestoreProgress[] = [];
    const knownStates: ReadonlyArray<ProofState> = [
      "available",
      "held",
      "handedOut",
      "externalized",
      "spent",
    ];
    const { run, events } = makeHarness({
      signed: [
        ...knownStates.map((state, slot) => ({
          slot,
          proof: proof(8, `known-${state}`),
        })),
        { slot: 5, proof: proof(4, "newly-found") },
      ],
      receive: async (text) => {
        expect(progress.at(-1)).toEqual({
          phase: "refreshing",
          completedKeysets: 1,
          totalKeysets: 1,
          totalMints: 1,
        });
        received.push(text);
        return [proof(2, "fresh-two"), proof(1, "fresh-one")];
      },
    });
    const exit = await run(
      Effect.gen(function* () {
        for (const state of knownStates)
          yield* seedProofs(mint, [proof(8, `known-${state}`)], state);
        const restore = yield* Restore;
        const first = yield* restore.restoreAndReclaim(
          new RestoreDraft({ mints: [mint] }),
          (update) => progress.push(update),
        );
        const second = yield* restore.restoreAndReclaim(
          new RestoreDraft({ mints: [mint] }),
        );
        return { first, second, proofs: yield* (yield* ProofStore).loadAll };
      }),
    );
    assert(Exit.isSuccess(exit));
    expect(received).toHaveLength(1);
    expect(
      getDecodedToken(received[0], [keysetHex]).proofs.map(
        (proof) => proof.secret,
      ),
    ).toEqual(["newly-found"]);
    expect(exit.value.first.restore.restoredAmount).toBe(4);
    expect(exit.value.first.reclaim.reclaimedAmount).toBe(3);
    expect(exit.value.second.restore.restoredProofs).toBe(0);
    for (const state of knownStates) {
      expect(
        exit.value.proofs.find((proof) => proof.secret === `known-${state}`)
          ?.state,
      ).toBe(state);
    }
    expect(
      exit.value.proofs.find((proof) => proof.secret === "newly-found")?.state,
    ).toBe("spent");
    expect(
      exit.value.proofs.find((proof) => proof.secret === "fresh-two")?.state,
    ).toBe("available");
    expect(
      events.some(
        (event) =>
          event._tag === "OperationSucceeded" &&
          event.name === "tokens.reclaim",
      ),
    ).toBe(true);
    expect(JSON.stringify(events)).not.toContain("newly-found");
  });

  it("keeps discovered proofs and reports an incomplete swap when the mint fails", async () => {
    const { run } = makeHarness({
      signed: [{ slot: 1, proof: proof(4, "found") }],
      receive: async () => {
        throw new Error("mint unavailable");
      },
    });
    const exit = await run(
      Effect.gen(function* () {
        const result = yield* (yield* Restore).restoreAndReclaim(
          new RestoreDraft({ mints: [mint] }),
        );
        return { result, proofs: yield* (yield* ProofStore).loadAll };
      }),
    );
    assert(Exit.isSuccess(exit));
    expect(exit.value.result.reclaim.reclaimedAmount).toBe(0);
    expect(exit.value.result.reclaim.unresolvedProofs).toEqual(
      exit.value.proofs.map((proof) => proof.id),
    );
    expect(exit.value.proofs[0]?.state).toBe("available");
  });
});

describe("Restore.wipeSeedBoundState", () => {
  it("drops counters, cursors, and locks but keeps what the seed does not own", async () => {
    const { run } = makeHarness({
      signed: [{ slot: 2, proof: proof(4, "r1") }],
    });

    const exit = await run(
      Effect.gen(function* () {
        const kv = yield* KeyValueStore;
        yield* kv.set(seenMintKey(mint), mint);
        yield* restoreAt();
        const restore = yield* Restore;
        yield* restore.wipeSeedBoundState;
        return {
          counter: yield* kv.get(counterKey),
          cursor: yield* kv.get(cursorKey),
          seenMint: yield* kv.get(seenMintKey(mint)),
          seenKeyset: yield* kv.get(seenKeysetKey(mint, sat, keysetHex)),
          proofs: (yield* (yield* ProofStore).loadAll).length,
        };
      }),
    );

    expect(exit).toEqual(
      Exit.succeed({
        counter: null,
        cursor: null,
        seenMint: mint,
        seenKeyset: keysetHex,
        proofs: 1,
      }),
    );
  });
});
