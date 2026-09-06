import * as Evolu from "@evolu/common";
import type { CashuTokenRow } from "../../evolu";
import { isCashuTokenErrorState } from "./cashuTokenState";

interface CashuRowPreferenceInput {
  activeOwnerId: string;
  candidate: Pick<CashuTokenRow, "isDeleted" | "ownerId" | "state">;
  existing: Pick<CashuTokenRow, "isDeleted" | "ownerId" | "state">;
  ownerRank: ReadonlyMap<string, number>;
}

export const isCashuRowCandidateBetter = ({
  activeOwnerId,
  candidate,
  existing,
  ownerRank,
}: CashuRowPreferenceInput): boolean => {
  const candidateOwnerId = candidate.ownerId;
  const existingOwnerId = existing.ownerId;
  const candidateRank = ownerRank.get(candidateOwnerId) ?? -1;
  const existingRank = ownerRank.get(existingOwnerId) ?? -1;
  const candidateIsDeleted = candidate.isDeleted === Evolu.sqliteTrue;
  const existingIsDeleted = existing.isDeleted === Evolu.sqliteTrue;

  // A tombstone in a newer owner lane must hide an older live duplicate.
  // Within one lane, however, a later valid re-import should beat an old
  // deleted alias rather than remaining invisible forever.
  if (candidateIsDeleted !== existingIsDeleted) {
    if (candidateRank !== existingRank) {
      return candidateRank > existingRank;
    }
    return !candidateIsDeleted;
  }

  const candidateIsError = isCashuTokenErrorState(candidate.state);
  const existingIsError = isCashuTokenErrorState(existing.state);
  if (candidateIsError !== existingIsError) {
    return !candidateIsError;
  }

  if (candidateOwnerId === activeOwnerId && existingOwnerId !== activeOwnerId) {
    return true;
  }

  if (existingOwnerId === activeOwnerId && candidateOwnerId !== activeOwnerId) {
    return false;
  }

  return candidateRank > existingRank;
};
