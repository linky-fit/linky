/**
 * Rows of the inventory tables keyed by a deterministic id can exist in
 * several cashu owner lanes when two devices ingested or wrote the same row
 * from different active lanes. Reads keep one row per id: the one in the
 * later lane (the lane order is the visibility order), unless `prefer`
 * names a winner — a `spent` proof in an older lane beats an `available`
 * copy, because spent is terminal.
 */
export const dedupeVisibleLaneRows = <
  Row extends { readonly id: string; readonly ownerId: string },
>(
  rows: readonly Row[],
  visibleOwnerIds: ReadonlySet<string>,
  prefer: (candidate: Row, existing: Row) => boolean | null = () => null,
): Row[] => {
  if (visibleOwnerIds.size === 0) return [];
  const rank = new Map(
    [...visibleOwnerIds].map((ownerId, index) => [ownerId, index]),
  );
  const best = new Map<string, Row>();
  for (const row of rows) {
    const ownerRank = rank.get(row.ownerId);
    if (ownerRank === undefined) continue;
    const existing = best.get(row.id);
    if (existing === undefined) {
      best.set(row.id, row);
      continue;
    }
    const preferred = prefer(row, existing);
    const wins = preferred ?? ownerRank > (rank.get(existing.ownerId) ?? -1);
    if (wins) best.set(row.id, row);
  }
  return [...best.values()];
};
