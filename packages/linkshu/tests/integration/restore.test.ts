import { Effect } from "effect";
import {
  Amount,
  ProofStore,
  Receive,
  ReceiveDraft,
  Restore,
  RestoreDraft,
  runLinkshu,
  Send,
  SendDraft,
} from "../../src";
import type { Bip39Seed } from "../../src";
import { availableTotalOf, fundToken, mintUrl, randomSeed } from "./helpers";

/** Everything the seed owns at the mint, with no storage to start from. */
const restoreFromSeedAlone = (seed: Bip39Seed) =>
  runLinkshu(
    { bip39Seed: seed },
    Effect.gen(function* () {
      const restore = yield* Restore;
      const first = yield* restore.restore(
        new RestoreDraft({ mints: [mintUrl] }),
      );
      // Re-running must be a no-op: the proofs are stored now.
      const second = yield* restore.restore(
        new RestoreDraft({ mints: [mintUrl] }),
      );
      return { first, second, proofs: yield* (yield* ProofStore).loadAll };
    }),
  );

describe("restore vertical against the local mint", () => {
  it("recovers the wallet balance on fresh storage, given only the seed", async () => {
    const seed = randomSeed();
    const funded = await fundToken(16);

    // The wallet earns a deterministic balance, then loses its storage.
    const { amount } = await runLinkshu(
      { bip39Seed: seed },
      Effect.gen(function* () {
        const receive = yield* Receive;
        return yield* receive.receive(new ReceiveDraft({ text: funded }));
      }),
    );

    const { first, second, proofs } = await restoreFromSeedAlone(seed);

    expect(first.restoredAmount).toBe(amount);
    expect(first.restoredProofs).toBe(proofs.length);
    expect(first.scannedMints).toEqual([mintUrl]);
    expect(first.unavailableMints).toEqual([]);

    // Idempotent: the mint still reports the same signatures, but every one
    // of them is already stored.
    expect(second.restoredAmount).toBe(0);
    expect(second.restoredProofs).toBe(0);
    expect(second.scannedMints).toEqual([mintUrl]);

    expect(proofs.length).toBeGreaterThan(0);
    expect(proofs.every((proof) => proof.state === "available")).toBe(true);
    expect(availableTotalOf(proofs)).toBe(amount);
  });

  it("leaves the counter past the recovered slots, so the wallet can spend", async () => {
    const seed = randomSeed();
    const funded = await fundToken(20);

    const sent = await runLinkshu(
      { bip39Seed: seed },
      Effect.gen(function* () {
        const receive = yield* Receive;
        const send = yield* Send;
        yield* receive.receive(new ReceiveDraft({ text: funded }));
        // A second deterministic operation, so recovery spans several slots.
        return yield* send.send(
          new SendDraft({
            mint: mintUrl,
            amount: Amount.make(4),
            produceAs: "issued",
          }),
        );
      }),
    );
    expect(sent.amount).toBe(4);

    // Fresh storage, same seed: restore, then spend what it recovered. A
    // counter left behind the recovered slots would collide at the mint.
    const { restored, receipt } = await runLinkshu(
      { bip39Seed: seed },
      Effect.gen(function* () {
        const restore = yield* Restore;
        const restored = yield* restore.restore(
          new RestoreDraft({ mints: [mintUrl] }),
        );
        const receipt = yield* (yield* Send).send(
          new SendDraft({
            mint: mintUrl,
            amount: Amount.make(2),
            produceAs: "issued",
          }),
        );
        return { restored, receipt };
      }),
    );

    expect(restored.restoredAmount).toBeGreaterThan(0);
    expect(receipt.amount).toBe(2);
  });
});
