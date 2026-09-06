import * as Evolu from "@evolu/common";
import { readField } from "../../utils/unknown";
import { trimString } from "../../utils/validation";

export const ACTIVE_NOSTR_IDENTITY_ROW_ID =
  Evolu.createIdFromString<"NostrIdentity">("active-nostr-identity");

interface SyncedNostrIdentity {
  nsec: string;
  npub: string | null;
  ownerId: string;
  source: "custom" | "derived";
  switchedAtSec: number | null;
}

interface SyncedNostrIdentityResolution {
  identity: SyncedNostrIdentity | null;
  shouldMigrateLegacyIdentity: boolean;
}

const readText = (row: object, key: string): string =>
  trimString(readField(row, key));

const readSwitchedAtSec = (row: object): number | null => {
  const value = Number(Reflect.get(row, "switchedAtSec"));
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.trunc(value);
};

const parseSyncedNostrIdentity = (row: object): SyncedNostrIdentity | null => {
  if (readText(row, "id") !== ACTIVE_NOSTR_IDENTITY_ROW_ID) return null;

  const nsec = readText(row, "nsec");
  const ownerId = readText(row, "ownerId");
  if (!nsec || !ownerId) return null;

  return {
    nsec,
    npub: readText(row, "npub") || null,
    ownerId,
    // The first synced custom-identity rows predate the `source` column.
    // A missing value therefore means custom, not derived.
    source: readText(row, "source") === "derived" ? "derived" : "custom",
    switchedAtSec: readSwitchedAtSec(row),
  };
};

export const resolveSyncedNostrIdentity = (
  rows: ReadonlyArray<object>,
  identityOwnerId: string,
  legacyOwnerIds: ReadonlySet<string>,
): SyncedNostrIdentityResolution => {
  if (!identityOwnerId) {
    return { identity: null, shouldMigrateLegacyIdentity: false };
  }

  const identities = rows
    .map(parseSyncedNostrIdentity)
    .filter((identity) => identity !== null);
  const identity = identities.find((row) => row.ownerId === identityOwnerId);
  if (identity) {
    return { identity, shouldMigrateLegacyIdentity: false };
  }

  const legacyIdentity = identities.find((row) =>
    legacyOwnerIds.has(row.ownerId),
  );
  return {
    identity: legacyIdentity ?? null,
    shouldMigrateLegacyIdentity: Boolean(legacyIdentity),
  };
};
