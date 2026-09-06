import {
  getDecodedToken,
  Mint,
  MintOperationError,
  Wallet,
} from "@cashu/cashu-ts";
import { Effect } from "effect";
import {
  Amount,
  NewTokenRow,
  runLinkshu,
  Send,
  SendDraft,
  TokenStore,
  TokenText,
} from "../../src";
import {
  claimExternally,
  fundProofs,
  mintUrl,
  randomSeed,
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
    const sourceToken = TokenText.make(tokenOf(sourceProofs));
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
        const tokens = yield* TokenStore;
        yield* tokens.insert(
          new NewTokenRow({
            originalTokenText: sourceToken,
            tokenText: sourceToken,
            state: "accepted",
            error: null,
          }),
        );
        const receipt = yield* (yield* Send).send(
          new SendDraft({
            mint: mintUrl,
            amount: Amount.make(2),
            produceAs: "issued",
          }),
        );
        return { receipt, rows: yield* tokens.loadAll };
      }),
    ).finally(() => swap.mockRestore());

    expect(collisions).toBe(1);
    expect(successfulSwaps).toBe(1);
    expect(result.receipt.amount).toBe(2);
    expect(result.receipt.changeAmount).toBe(29);
    expect(result.receipt.feePaid).toBe(1);
    expect(result.rows).toHaveLength(2);
    const sourceStates = await previous.checkProofsStates(sourceProofs);
    expect(sourceStates.every((state) => state.state === "SPENT")).toBe(true);
    for (const row of result.rows) {
      const proofs = getDecodedToken(row.tokenText, [previous.keysetId]).proofs;
      expect(
        (await previous.checkProofsStates(proofs)).every(
          (state) => state.state === "UNSPENT",
        ),
      ).toBe(true);
      await claimExternally(row.tokenText);
      expect(
        (await previous.checkProofsStates(proofs)).every(
          (state) => state.state === "SPENT",
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
