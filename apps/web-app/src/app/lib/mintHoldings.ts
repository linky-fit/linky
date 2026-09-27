import type { StoredProof } from "@linky/linkshu";
import { normalizeMintUrl } from "../../utils/mint";

export interface MintHolding {
  /** Sum of `available` proofs, in sat. */
  readonly balance: number;
  readonly availableCount: number;
}

const emptyHolding: MintHolding = {
  balance: 0,
  availableCount: 0,
};

const addAvailableProof = (
  holding: MintHolding,
  proof: StoredProof,
): MintHolding => ({
  balance: holding.balance + proof.amount,
  availableCount: holding.availableCount + 1,
});

/** Per-mint balance and count of `available` proofs, keyed by normalized mint url. */
export const mintHoldings = (
  proofs: ReadonlyArray<StoredProof>,
): ReadonlyMap<string, MintHolding> => {
  const holdings = new Map<string, MintHolding>();
  for (const proof of proofs) {
    if (proof.state !== "available") continue;
    const mint = normalizeMintUrl(proof.mint);
    holdings.set(
      mint,
      addAvailableProof(holdings.get(mint) ?? emptyHolding, proof),
    );
  }
  return holdings;
};

export const holdingOf = (
  holdings: ReadonlyMap<string, MintHolding>,
  mint: string,
): MintHolding => holdings.get(normalizeMintUrl(mint)) ?? emptyHolding;
