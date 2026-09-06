import type { Proof, ProofLike, ProofState } from "@cashu/cashu-ts";
import { Amount as CashuAmount } from "@cashu/cashu-ts";
import type { LoadedWallet } from "../mint/internal/WalletInstances";

export const KEYSET_HEX = "009a1f293253e41e";

export const proof = (amount: number, secret: string): Proof => ({
  id: KEYSET_HEX,
  amount: CashuAmount.from(amount),
  secret,
  C: "02" + "ab".repeat(32),
});

const notUnderTest = () => Promise.reject(new Error("not under test"));

/** A wallet whose every call fails; tests override only what they exercise. */
export const fakeWallet = (
  overrides: Partial<LoadedWallet> = {},
): LoadedWallet => ({
  keysetId: KEYSET_HEX,
  keyChain: { getKeysets: () => [] },
  getMintInfo: () => {
    throw new Error("not under test");
  },
  receive: notUnderTest,
  send: notUnderTest,
  checkProofsStates: notUnderTest,
  createMintQuoteBolt11: notUnderTest,
  checkMintQuoteBolt11: notUnderTest,
  mintProofsBolt11: notUnderTest,
  createMeltQuoteBolt11: notUnderTest,
  checkMeltQuoteBolt11: notUnderTest,
  meltProofsBolt11: notUnderTest,
  restore: notUnderTest,
  batchRestore: notUnderTest,
  ...overrides,
});

export type ProofStateName = ProofState["state"];

/** A NUT-07 answer naming `stateOf(secret)` for every proof asked about. */
export const answerProofStates =
  (stateOf: (secret: string) => ProofStateName = () => "UNSPENT") =>
  (proofs: Array<Pick<ProofLike, "secret" | "id">>): Promise<ProofState[]> =>
    Promise.resolve(
      proofs.map((entry) => ({
        Y: entry.secret ?? "",
        state: stateOf(entry.secret ?? ""),
        witness: null,
      })),
    );
