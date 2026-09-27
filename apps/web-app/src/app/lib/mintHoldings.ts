import type { StoredProof } from "@linky/linkshu";
import { normalizeMintUrl } from "../../utils/mint";

export interface MintHolding {
  /** Sum of `available` proofs, in sat. */
  readonly balance: number;
  readonly availableCount: number;
  readonly heldCount: number;
  /** Handed out and externalized proofs. */
  readonly handedOutCount: number;
}

const emptyHolding: MintHolding = {
  balance: 0,
  availableCount: 0,
  heldCount: 0,
  handedOutCount: 0,
};

const addProof = (holding: MintHolding, proof: StoredProof): MintHolding => {
  switch (proof.state) {
    case "available":
      return {
        ...holding,
        balance: holding.balance + proof.amount,
        availableCount: holding.availableCount + 1,
      };
    case "held":
      return { ...holding, heldCount: holding.heldCount + 1 };
    case "handedOut":
    case "externalized":
      return { ...holding, handedOutCount: holding.handedOutCount + 1 };
    case "spent":
      return holding;
  }
};

/** Per-mint balance and proof counts, keyed by normalized mint url. */
export const mintHoldings = (
  proofs: ReadonlyArray<StoredProof>,
): ReadonlyMap<string, MintHolding> => {
  const holdings = new Map<string, MintHolding>();
  for (const proof of proofs) {
    const mint = normalizeMintUrl(proof.mint);
    holdings.set(mint, addProof(holdings.get(mint) ?? emptyHolding, proof));
  }
  return holdings;
};

export const holdingOf = (
  holdings: ReadonlyMap<string, MintHolding>,
  mint: string,
): MintHolding => holdings.get(normalizeMintUrl(mint)) ?? emptyHolding;
