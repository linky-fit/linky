import * as Evolu from "@evolu/common";
import { readRowOwnerId } from "./rowOwnerId";

export const resolveContactRowOwnerLane = (
  row: unknown,
  visibleOwnerIds: readonly Evolu.OwnerId[],
): Evolu.OwnerId | null => {
  const rowOwnerId = readRowOwnerId(row);
  if (!rowOwnerId) return null;
  return visibleOwnerIds.find((ownerId) => ownerId === rowOwnerId) ?? null;
};
