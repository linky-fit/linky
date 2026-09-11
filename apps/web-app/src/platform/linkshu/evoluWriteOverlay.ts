import type * as Evolu from "@evolu/common";

/**
 * The linkshu store adapters read React render state, which lags Evolu
 * mutations by at least one render, while the package chains writes and
 * reads within one operation (Send inserts proofs, then marks the consumed
 * inputs spent). So each adapter keeps an overlay of its own writes and
 * serves those until the lagging read model reflects each one — otherwise
 * the follow-up read would miss the just-written row and silently no-op.
 *
 * Mutations must target the owner lane the row is stored in: Evolu keys rows
 * by `(ownerId, id)`, so an update against the active lane on a row that
 * lives in an older `cashu-n` lane writes a phantom row. The overlay keeps
 * the lane per row for that reason.
 */
export interface OverlayEntry<Stored> {
  row: Stored;
  readonly lane: Evolu.OwnerId;
}

export const makeWriteOverlay = <Stored extends { readonly id: string }>(
  reflects: (loaded: Stored, written: Stored) => boolean,
) => {
  const entries = new Map<string, OverlayEntry<Stored>>();
  return {
    get: (id: string): OverlayEntry<Stored> | undefined => entries.get(id),
    set: (row: Stored, lane: Evolu.OwnerId): void => {
      entries.set(row.id, { row, lane });
    },
    /**
     * The loaded rows with overlay writes applied on top; an overlay entry
     * the read model has caught up with is dropped.
     */
    merge: (loaded: ReadonlyArray<Stored>): Stored[] => {
      const seen = new Set<string>();
      const result: Stored[] = [];
      for (const row of loaded) {
        seen.add(row.id);
        const entry = entries.get(row.id);
        if (entry === undefined) {
          result.push(row);
          continue;
        }
        if (reflects(row, entry.row)) {
          entries.delete(row.id);
          result.push(row);
        } else {
          result.push(entry.row);
        }
      }
      for (const [id, entry] of entries) {
        if (!seen.has(id)) result.push(entry.row);
      }
      return result;
    },
  };
};
