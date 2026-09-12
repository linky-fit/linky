import { Effect, Exit } from "effect";
import { CurrencyUnit, KeysetId, MintUrl } from "../domain/primitives";
import { inMemoryKeyValueStore } from "../ports/inMemoryKeyValueStore";
import { KeyValueStore } from "../ports/KeyValueStore";
import { fakeWallet, KEYSET_HEX, proof } from "../testing/fakeWallet";
import { recordingInspector } from "../testing/inspector";
import { recoverFromCollision } from "./collisionRecovery";
import { DERIVATION_GAP_LIMIT, readCounter } from "./counters";
import type { CounterScope } from "./counters";

const scope: CounterScope = {
  mint: MintUrl.make("https://mint.example"),
  unit: CurrencyUnit.make("sat"),
  keysetId: KeysetId.make(KEYSET_HEX),
};

interface RestoreCall {
  readonly gapLimit: number | undefined;
  readonly batchSize: number | undefined;
  readonly start: number | undefined;
  readonly keysetId: string | undefined;
}

/** A wallet whose tree has a signature at every slot in `signedSlots`. */
const walletWithSignedSlots = (signedSlots: ReadonlyArray<number>) => {
  const calls: RestoreCall[] = [];
  const wallet = fakeWallet({
    batchRestore: (gapLimit, batchSize, start = 0, keysetId) => {
      calls.push({ gapLimit, batchSize, start, keysetId });
      const found = signedSlots.filter((slot) => slot >= start);
      return Promise.resolve({
        proofs: found.map((slot) => proof(1, `secret-${slot}`)),
        ...(found.length > 0
          ? { lastCounterWithSignature: Math.max(...found) }
          : {}),
      });
    },
  });
  return { wallet, calls };
};

const recover = (
  wallet: ReturnType<typeof fakeWallet>,
  counter: number,
  raw: unknown,
) =>
  Effect.runPromiseExit(
    Effect.gen(function* () {
      const kv = yield* KeyValueStore;
      const { service: inspector } = recordingInspector();
      const next = yield* recoverFromCollision(
        { kv, inspector, wallet, scope, fallbackBump: 64 },
        counter,
        raw,
      );
      return { next, stored: yield* readCounter(kv, scope) };
    }).pipe(Effect.provide(inMemoryKeyValueStore)),
  );

describe("recoverFromCollision", () => {
  it("walks the whole signed region and lands right past its last slot", async () => {
    // The counter lags the tree by far more than one restore batch: the
    // sender's other context already used slots 1..950.
    const signedSlots = Array.from({ length: 950 }, (_, index) => index + 1);
    const { wallet, calls } = walletWithSignedSlots(signedSlots);

    const exit = await recover(
      wallet,
      1,
      new Error("Mint error: outputs already signed"),
    );

    expect(exit).toEqual(Exit.succeed({ next: 951, stored: 951 }));
    expect(calls).toEqual([
      {
        gapLimit: DERIVATION_GAP_LIMIT,
        batchSize: 100,
        start: 1,
        keysetId: KEYSET_HEX,
      },
    ]);
  });

  it("falls back to a blind bump when the tree holds no signature ahead", async () => {
    const { wallet } = walletWithSignedSlots([]);

    const exit = await recover(
      wallet,
      10,
      new Error("Mint error: outputs already signed"),
    );

    expect(exit).toEqual(Exit.succeed({ next: 74, stored: 74 }));
  });

  it("bumps blindly without probing for collisions restore cannot see", async () => {
    const { wallet, calls } = walletWithSignedSlots([500]);

    const exit = await recover(
      wallet,
      10,
      new Error("Mint error: outputs are pending"),
    );

    expect(exit).toEqual(Exit.succeed({ next: 74, stored: 74 }));
    expect(calls).toEqual([]);
  });

  it("bumps blindly when the probe itself fails", async () => {
    const wallet = fakeWallet({
      batchRestore: () => Promise.reject(new Error("mint down")),
    });

    const exit = await recover(
      wallet,
      10,
      new Error("Mint error: outputs already signed"),
    );

    expect(exit).toEqual(Exit.succeed({ next: 74, stored: 74 }));
  });
});
