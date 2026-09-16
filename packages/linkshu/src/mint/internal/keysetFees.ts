import { splitAmount, type Keyset } from "@cashu/cashu-ts";
import type { LoadedWallet } from "./WalletInstances";

/** The keyset the wallet signs new outputs with. */
const boundKeyset = (wallet: LoadedWallet): Keyset | undefined =>
  wallet.keyChain.getKeysets().find((keyset) => keyset.id === wallet.keysetId);

/** Fee of the keyset the wallet is bound to, as the mint published it. */
export const boundKeysetInputFeePpk = (wallet: LoadedWallet): number | null =>
  boundKeyset(wallet)?.toMintKeyset().input_fee_ppk ?? null;

/** NUT-02: the fee of a swap is the summed per-proof fee, rounded up. */
const feeOfPpkSum = (ppkSum: number): number => Math.ceil(ppkSum / 1000);

/**
 * Upper bound on the cashu input fee a swap over `proofCount` proofs pays
 * (NUT-02: `ceil(ppk * inputs / 1000)`). Sizing an amount down by it keeps the
 * swap that follows from coming up short.
 */
export const inputFeeAllowance = (
  wallet: LoadedWallet,
  proofCount: number,
): number => {
  const ppk = boundKeysetInputFeePpk(wallet);
  return ppk === null || ppk <= 0 ? 0 : feeOfPpkSum(ppk * proofCount);
};

/**
 * The cashu input fee a swap over exactly these proofs pays, from the fee each
 * proof's keyset publishes. A keyset the wallet does not know counts as free:
 * the mint states its fee when it answers.
 */
export const inputFeeForProofs = (
  wallet: LoadedWallet,
  proofs: ReadonlyArray<{ readonly id: string }>,
): number => {
  const ppkByKeyset = new Map(
    wallet.keyChain
      .getKeysets()
      .map((keyset) => [keyset.id, keyset.toMintKeyset().input_fee_ppk ?? 0]),
  );
  return feeOfPpkSum(
    proofs.reduce((sum, proof) => sum + (ppkByKeyset.get(proof.id) ?? 0), 0),
  );
};

/**
 * Proof count of the split a swap produces for `amount` from the bound
 * keyset's published denominations, made by the same function cashu-ts uses.
 * Null when the keyset cannot split it (no keys loaded, or no denomination
 * fits), which the swap itself fails on.
 */
const swapProofCount = (
  wallet: LoadedWallet,
  amount: number,
): number | null => {
  const keyset = boundKeyset(wallet);
  if (keyset === undefined || !keyset.hasKeys) return null;
  try {
    return splitAmount(amount, keyset.keys).length;
  } catch {
    return null;
  }
};

/**
 * The input fee whoever redeems a token of `amount` pays: the fee of the
 * split a send swap produces on the bound keyset. Zero when that split is
 * unknown, leaving the mint to answer.
 */
export const inputFeeForAmount = (
  wallet: LoadedWallet,
  amount: number,
): number => {
  const proofCount = swapProofCount(wallet, amount);
  return proofCount === null ? 0 : inputFeeAllowance(wallet, proofCount);
};
