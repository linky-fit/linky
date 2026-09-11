import { Mint, MintOperationError, Wallet } from "@cashu/cashu-ts";
import { Effect } from "effect";
import { Amount, ProofStore, runLinkshu, Send, SendDraft } from "../../src";
import { amountIn, proofsIn } from "../../src/testing/inventory";
import {
  availableRowsOf,
  claimExternally,
  fundProofs,
  mintUrl,
  randomSeed,
  toCashuProofs,
  tokenOf,
} from "./helpers";

const outputConfig = {
  send: { type: "deterministic", counter: 1 },
  keep: { type: "deterministic", counter: 65 },
} satisfies Parameters<Wallet["prepareSwapToSend"]>[3];

describe("deterministic output collisions against the local mint", () => {
  it("recovers a CDK historical-output collision after restarting with fresh counters", async () => {
    const seed = randomSeed();
    const previous = new Wallet(new Mint(mintUrl), {
      unit: "sat",
      bip39seed: seed,
    });
    await previous.loadMint();
    const used = await previous.prepareSwapToSend(
      2,
      await fundProofs(32),
      undefined,
      outputConfig,
    );
    const usedOutputs = new Set(
      [...(used.sendOutputs ?? []), ...(used.keepOutputs ?? [])].map(
        (output) => output.blindedMessage.B_,
      ),
    );
    await previous.completeSwap(used);

    const sourceProofs = await fundProofs(32);
    const originalSwap = Mint.prototype.swap;
    let collisions = 0;
    let successfulSwaps = 0;
    const swap = vi
      .spyOn(Mint.prototype, "swap")
      .mockImplementation(async function (this: Mint, payload, customRequest) {
        const outputs = payload.outputs.map((output) => output.B_);
        expect(new Set(outputs).size).toBe(outputs.length);
        try {
          const response = await originalSwap.call(
            this,
            payload,
            customRequest,
          );
          successfulSwaps += 1;
          expect(outputs.every((output) => !usedOutputs.has(output))).toBe(
            true,
          );
          return response;
        } catch (error) {
          if (!(error instanceof MintOperationError) || error.code !== 11003) {
            throw error;
          }
          expect(outputs.some((output) => usedOutputs.has(output))).toBe(true);
          const states = await previous.checkProofsStates(sourceProofs);
          expect(states.every((state) => state.state === "UNSPENT")).toBe(true);
          collisions += 1;
          // CDK maps an existing blinded-message database row to 11008.
          throw new MintOperationError(11008, "Duplicate outputs");
        }
      });

    const result = await runLinkshu(
      { bip39Seed: seed },
      Effect.gen(function* () {
        const proofStore = yield* ProofStore;
        yield* proofStore.insert(availableRowsOf(sourceProofs));
        const receipt = yield* (yield* Send).send(
          new SendDraft({
            mint: mintUrl,
            amount: Amount.make(2),
            produceAs: "issued",
          }),
        );
        return { receipt, proofs: yield* proofStore.loadAll };
      }),
    ).finally(() => swap.mockRestore());

    expect(collisions).toBe(1);
    expect(successfulSwaps).toBe(1);
    expect(result.receipt.amount).toBe(2);
    expect(result.receipt.changeAmount).toBe(29);
    expect(result.receipt.feePaid).toBe(1);
    // The 32 source sats are spent on record; 2 handed out, 29 kept.
    expect(amountIn(result.proofs, "spent")).toBe(32);
    expect(amountIn(result.proofs, "handedOut")).toBe(2);
    expect(amountIn(result.proofs, "available")).toBe(29);
    const sourceStates = await previous.checkProofsStates(sourceProofs);
    expect(sourceStates.every((state) => state.state === "SPENT")).toBe(true);
    for (const state of ["handedOut", "available"] as const) {
      const proofs = toCashuProofs(proofsIn(result.proofs, state));
      expect(
        (await previous.checkProofsStates(proofs)).every(
          (entry) => entry.state === "UNSPENT",
        ),
      ).toBe(true);
      await claimExternally(tokenOf(proofs));
      expect(
        (await previous.checkProofsStates(proofs)).every(
          (entry) => entry.state === "SPENT",
        ),
      ).toBe(true);
    }
  });

  it("rejects genuinely repeated outputs without spending the inputs", async () => {
    const wallet = new Wallet(new Mint(mintUrl), {
      unit: "sat",
      bip39seed: randomSeed(),
    });
    await wallet.loadMint();
    const sourceProofs = await fundProofs(32);
    const prepared = await wallet.prepareSwapToSend(
      2,
      sourceProofs,
      undefined,
      outputConfig,
    );
    const outputs = [
      ...(prepared.sendOutputs ?? []),
      ...(prepared.keepOutputs ?? []),
    ].map((output) => output.blindedMessage);
    const first = outputs[0];
    if (!first) throw new Error("Expected generated outputs");
    const duplicateOutputs = outputs.map((output, index) =>
      index === outputs.length - 1 ? { ...output, B_: first.B_ } : output,
    );
    expect(new Set(duplicateOutputs.map((output) => output.B_)).size).toBe(
      outputs.length - 1,
    );
    await expect(
      wallet.mint.swap({
        inputs: prepared.inputs,
        outputs: duplicateOutputs,
      }),
    ).rejects.toMatchObject({ code: 11008 });
    const states = await wallet.checkProofsStates(sourceProofs);
    expect(states.every((state) => state.state === "UNSPENT")).toBe(true);
  });
});
