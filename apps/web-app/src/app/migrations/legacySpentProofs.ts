import type { CashuProofId, OwnerId } from "@linky/linksync";

interface ProofState {
  readonly id: CashuProofId;
  readonly state: string | null;
}

interface LegacyProofState extends ProofState {
  readonly ownerId: OwnerId;
}

export const legacyProofsToMarkSpent = <T extends LegacyProofState>(
  legacy: ReadonlyArray<T>,
  shardCopies: ReadonlyArray<ProofState>,
  legacyOwnerIds: ReadonlySet<string>,
): ReadonlyArray<T> => {
  const spent = new Set(
    shardCopies
      .filter((proof) => proof.state === "spent")
      .map((proof) => proof.id),
  );
  return legacy.filter(
    (proof) =>
      legacyOwnerIds.has(proof.ownerId) &&
      proof.state !== "spent" &&
      spent.has(proof.id),
  );
};
