import type { NostrIdentityRow } from "@linky/linksync";
import { trimString } from "../../utils/validation";

export interface SyncedNostrIdentity {
  nsec: string;
  npub: string | null;
  source: "custom" | "derived";
  switchedAtSec: number | null;
}

/** The identity row as the app reads it; null when the row carries no key yet. */
export const toSyncedNostrIdentity = (
  row: NostrIdentityRow,
): SyncedNostrIdentity | null => {
  const nsec = trimString(row.nsec);
  if (!nsec) return null;
  return {
    nsec,
    npub: trimString(row.npub) || null,
    // The first synced custom-identity rows predate the `source` column.
    // A missing value therefore means custom, not derived.
    source: trimString(row.source) === "derived" ? "derived" : "custom",
    switchedAtSec:
      row.switchedAtSec !== null && row.switchedAtSec > 0
        ? Math.trunc(row.switchedAtSec)
        : null,
  };
};
