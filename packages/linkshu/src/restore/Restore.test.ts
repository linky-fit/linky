import type { Proof as CashuProof } from "@cashu/cashu-ts";
import { getEncodedToken, Keyset } from "@cashu/cashu-ts";
import { Effect, Exit, Layer } from "effect";
import { MintUnreachable } from "../domain/errors";
import {
  CurrencyUnit,
  KeysetId,
  MintUrl,
  TokenText,
} from "../domain/primitives";
import { deterministicCounterKey } from "../internal/counters";
import { seenMintKey, WalletInstances } from "../mint/internal/WalletInstances";
import { inMemoryKeyValueStore } from "../ports/inMemoryKeyValueStore";
import { inMemoryTokenStore } from "../ports/inMemoryTokenStore";
import { KeyValueStore } from "../ports/KeyValueStore";
import { NewTokenRow, TokenStore } from "../ports/TokenStore";
import { fakeWallet, KEYSET_HEX, proof } from "../testing/fakeWallet";
import { recordingInspector } from "../testing/inspector";
import { parseTokenText } from "../token/codec";
import { RestoreDraft } from "./domain";
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
  stateOf?: (secret: string) => "UNSPENT" | "PENDING" | "SPENT";
  restoreError?: unknown;
  walletUnreachable?: boolean;
}

const makeHarness = (args: HarnessArgs) => {
  const restoreCalls: Array<RestoreCall> = [];
  const inspector = recordingInspector();
  const signed = args.signed ?? [];

  const wallet = fakeWallet({
    keysetId: keysetHex,
    keyChain: {
      getKeysets: () => [
        ...(args.keysets ?? [new Keyset(keysetHex, "sat", true, 0)]),
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
      if (args.restoreError !== undefined) {
        return Promise.reject(args.restoreError);
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
              args.walletUnreachable === true
                ? Effect.fail(
                    new MintUnreachable({ mint: requested, detail: null }),
                  )
                : Effect.succeed(wallet),
          }),
        ),
        inMemoryKeyValueStore,
        inMemoryTokenStore,
        inspector.layer,
      ),
    ),
  );

  const run = <A, E>(
    program: Effect.Effect<A, E, Restore | TokenStore | KeyValueStore>,
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
      rows: yield* (yield* TokenStore).loadAll,
      counter: yield* kv.get(counterKey),
      cursor: yield* kv.get(cursorKey),
    };
  });

describe("Restore.restore", () => {
  it("recovers signed proofs into an accepted row and moves cursor and counter past them", async () => {
    const { run, restoreCalls } = makeHarness({
      signed: [
        { slot: 3, proof: proof(4, "r1") },
        { slot: 5, proof: proof(8, "r2") },
      ],
    });

    const exit = await run(restoreAt());

    assert(Exit.isSuccess(exit));
    const { report, rows, counter, cursor } = exit.value;

    expect(report.restoredAmount).toBe(12);
    expect(report.rows).toHaveLength(1);
    expect(report.scannedMints).toEqual([mint]);
    expect(report.unavailableMints).toEqual([]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe("accepted");
    expect(parseTokenText(rows[0]?.tokenText ?? "")?.amount).toBe(12);

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
    expect(exit.value.second.report.rows).toEqual([]);
    expect(exit.value.second.rows).toHaveLength(1);
    expect(exit.value.second.cursor).toBe("4");
  });

  it("imports only the proofs the mint reports unspent", async () => {
    const { run } = makeHarness({
      signed: [
        { slot: 1, proof: proof(4, "spent") },
        { slot: 2, proof: proof(8, "live") },
      ],
      stateOf: (secret) => (secret === "spent" ? "SPENT" : "UNSPENT"),
    });

    const exit = await run(restoreAt());

    assert(Exit.isSuccess(exit));
    expect(exit.value.report.restoredAmount).toBe(8);
    expect(parseTokenText(exit.value.rows[0]?.tokenText ?? "")?.amount).toBe(8);
  });

  it("skips proofs already stored in any row", async () => {
    const stored = getEncodedToken({
      mint,
      unit: "sat",
      proofs: [proof(4, "r1")],
    });
    const { run } = makeHarness({
      signed: [
        { slot: 1, proof: proof(4, "r1") },
        { slot: 2, proof: proof(8, "r2") },
      ],
    });

    const exit = await run(
      Effect.gen(function* () {
        yield* (yield* TokenStore).insert(
          new NewTokenRow({
            originalTokenText: TokenText.make(stored),
            tokenText: TokenText.make(stored),
            state: "issued",
            error: null,
          }),
        );
        return yield* restoreAt();
      }),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.report.restoredAmount).toBe(8);
  });

  it("reports an unreachable mint instead of failing", async () => {
    const { run } = makeHarness({
      signed: [{ slot: 1, proof: proof(4, "r1") }],
      restoreError: new TypeError("fetch failed"),
    });

    const exit = await run(restoreAt());

    assert(Exit.isSuccess(exit));
    expect(exit.value.report).toMatchObject({
      restoredAmount: 0,
      scannedMints: [],
      unavailableMints: [mint],
    });
    expect(exit.value.rows).toEqual([]);
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

  it("emits the restore operation and the counter move, without proof secrets", async () => {
    const { run, events } = makeHarness({
      signed: [{ slot: 2, proof: proof(4, "r1") }],
    });

    await run(restoreAt());

    expect(events.map((event) => event._tag)).toEqual([
      "TokenLifecycleChanged",
      "CounterAdvanced",
      "OperationSucceeded",
    ]);
    expect(events[1]).toMatchObject({ from: 1, to: 3, reason: "restore" });
    expect(events[2]).toMatchObject({ name: "restore.restore" });
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("r1");
    expect(serialized).not.toContain("cashu");
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
        };
      }),
    );

    expect(exit).toEqual(
      Exit.succeed({
        counter: null,
        cursor: null,
        seenMint: mint,
        seenKeyset: keysetHex,
      }),
    );
  });
});
