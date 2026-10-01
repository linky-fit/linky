import type { StoredOperation, StoredProof } from "@linky-fit/linkshu";
import { normalizeMintUrl } from "../../utils/mint";

export interface MintHolding {
  /** Sum of `available` proofs, in sat. */
  readonly balance: number;
  /** Face value of tokens waiting for the mint to answer, in sat. */
  readonly pending: number;
}

const emptyHolding: MintHolding = { balance: 0, pending: 0 };

/**
 * Per-mint balance of `available` proofs and of pending deferred receives,
 * keyed by normalized mint url.
 */
export const mintHoldings = (
  proofs: ReadonlyArray<StoredProof>,
  deferredReceives: ReadonlyArray<StoredOperation> = [],
): ReadonlyMap<string, MintHolding> => {
  const holdings = new Map<string, MintHolding>();
  const add = (mint: string, change: Partial<MintHolding>): void => {
    const key = normalizeMintUrl(mint);
    const current = holdings.get(key) ?? emptyHolding;
    holdings.set(key, {
      balance: current.balance + (change.balance ?? 0),
      pending: current.pending + (change.pending ?? 0),
    });
  };
  for (const proof of proofs) {
    if (proof.state === "available") add(proof.mint, { balance: proof.amount });
  }
  for (const deferred of deferredReceives) {
    add(deferred.mint, { pending: deferred.amount });
  }
  return holdings;
};

export const holdingOf = (
  holdings: ReadonlyMap<string, MintHolding>,
  mint: string,
): MintHolding => holdings.get(normalizeMintUrl(mint)) ?? emptyHolding;
