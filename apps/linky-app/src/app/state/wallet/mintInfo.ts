import { PositiveInt, sqliteTrue } from "@linky-fit/linksync";
import { Option, Schema } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import { LOCAL_MINT_INFO_STORAGE_KEY_PREFIX } from "../../../utils/constants";
import { normalizeMintUrl } from "../../../utils/mint";
import { readKvJson, writeKvJson } from "../../../utils/storage";
import { makeLocalId } from "../../../utils/validation";
import {
  getActiveMintInfoRows,
  getMintInfoByUrlMap,
  getMintInfoDedupedRows,
  isMintDeletedRow,
  mintInfoRowFields,
  repairStoredMintInfoRow,
} from "../../hooks/mint/mintInfoHelpers";
import type { LocalMintInfoRow } from "../../types/appTypes";
import { platformAtom } from "../platform";
import { appOwnerIdAtom } from "../session/store";
import { defaultMintAtom } from "./defaultMint";
import { ownerStorageKey } from "./ownerStorage";

const OptionalStoredValue = Schema.optional(
  Schema.NullOr(Schema.Union([Schema.String, Schema.Number, Schema.Boolean])),
);

const StoredMintInfoRow = Schema.Struct({
  feesJson: Schema.optional(Schema.NullOr(Schema.String)),
  firstSeenAtSec: Schema.optional(Schema.NullOr(Schema.Number)),
  id: Schema.String,
  infoJson: Schema.optional(Schema.NullOr(Schema.String)),
  isDeleted: OptionalStoredValue,
  lastCheckedAtSec: Schema.optional(Schema.NullOr(Schema.Number)),
  lastSeenAtSec: Schema.optional(Schema.NullOr(Schema.Number)),
  supportsMpp: OptionalStoredValue,
  url: Schema.String,
});

const isStoredMintInfoRow = Schema.is(StoredMintInfoRow);

const mintInfoStorageKey = (ownerId: string) =>
  ownerStorageKey(LOCAL_MINT_INFO_STORAGE_KEY_PREFIX, ownerId);

interface OwnedMintInfoRows {
  readonly ownerId: string | null;
  readonly rows: LocalMintInfoRow[];
}

const ownedMintInfoRowsAtom = Atom.keepAlive(
  Atom.writable(
    (get): OwnedMintInfoRows => {
      const ownerId = Option.getOrNull(AsyncResult.value(get(appOwnerIdAtom)));
      const current = Option.getOrNull(get.self<OwnedMintInfoRows>());
      if (current !== null && current.ownerId === ownerId) return current;
      return {
        ownerId,
        rows:
          ownerId === null
            ? []
            : readKvJson(
                get(platformAtom).kv,
                mintInfoStorageKey(ownerId),
                Schema.Array(Schema.Unknown),
                [],
              )
                .filter(isStoredMintInfoRow)
                .map(repairStoredMintInfoRow),
      };
    },
    (ctx, rows: LocalMintInfoRow[]) => {
      const { ownerId } = ctx.get(ownedMintInfoRowsAtom);
      if (ownerId === null) return;
      writeKvJson(ctx.get(platformAtom).kv, mintInfoStorageKey(ownerId), rows);
      ctx.setSelf({ ownerId, rows });
    },
  ),
);

/**
 * Every mint this device knows for the app owner, deleted ones included;
 * each write is stored under the owner's mint info key.
 */
export const mintInfoRowsAtom = Atom.writable(
  (get) => get(ownedMintInfoRowsAtom).rows,
  (ctx, rows: LocalMintInfoRow[]) => ctx.set(ownedMintInfoRowsAtom, rows),
);

export const mintInfoByUrlAtom = Atom.readable((get) =>
  getMintInfoByUrlMap(get(mintInfoRowsAtom)),
);

/** One row per mint, the default mint first, then the most recently seen. */
export const mintInfoDedupedAtom = Atom.readable((get) =>
  getMintInfoDedupedRows(
    getActiveMintInfoRows(get(mintInfoRowsAtom)),
    get(defaultMintAtom),
  ),
);

export interface MintRuntime {
  readonly lastCheckedAtSec: number;
  readonly latencyMs: number | null;
}

/** When each mint was last asked for its info this session, and how fast it answered. */
export const mintRuntimeAtom = Atom.keepAlive(
  Atom.make<Readonly<Record<string, MintRuntime>>>({}),
);

/** Mint icon URLs that failed to load this session. */
export const failedMintIconUrlsAtom = Atom.keepAlive(
  Atom.make<ReadonlySet<string>>(new Set<string>()),
);

/** Refreshes in flight and the last successful one per mint, shared by every caller. */
export const mintInfoRefreshesAtom = Atom.keepAlive(
  Atom.readable(() => ({
    inFlight: new Set<string>(),
    lastSuccessfulAtSec: new Map<string, number>(),
  })),
);

export const isMintDeleted = (
  rows: readonly LocalMintInfoRow[],
  mintUrl: string,
): boolean => {
  const cleaned = normalizeMintUrl(mintUrl);
  if (!cleaned) return false;
  return rows.some(
    (row) => normalizeMintUrl(row.url) === cleaned && isMintDeletedRow(row),
  );
};

/** The rows with `mintUrl` marked seen at `nowSec`, or null when nothing changes. */
export const touchedMintInfoRows = (
  rows: LocalMintInfoRow[],
  mintUrl: string,
  nowSec: number,
): LocalMintInfoRow[] | null => {
  const existing = getMintInfoByUrlMap(rows).get(mintUrl);
  const now = PositiveInt.orThrow(Math.floor(nowSec));
  if (!existing || isMintDeletedRow(existing)) {
    return [
      ...rows,
      {
        id: makeLocalId(),
        url: mintUrl,
        firstSeenAtSec: now,
        lastSeenAtSec: now,
        supportsMpp: null,
        feesJson: null,
        infoJson: null,
      },
    ];
  }
  const firstSeen =
    (existing.firstSeenAtSec ?? 0) > 0
      ? Math.floor(Number(existing.firstSeenAtSec))
      : now;
  const idx = rows.findIndex((row) => row.id === existing.id);
  const current = rows[idx];
  if (
    idx < 0 ||
    current === undefined ||
    (current.url === mintUrl &&
      (current.firstSeenAtSec ?? 0) === firstSeen &&
      (current.lastSeenAtSec ?? 0) === now)
  ) {
    return null;
  }
  const next = [...rows];
  next[idx] = {
    ...current,
    url: mintUrl,
    firstSeenAtSec: firstSeen,
    lastSeenAtSec: now,
  };
  return next;
};

/** The rows with the info a mint just answered stored under `mintUrl`. */
export const refreshedMintInfoRows = (
  rows: LocalMintInfoRow[],
  mintUrl: string,
  fields: ReturnType<typeof mintInfoRowFields>,
  nowSec: number,
): LocalMintInfoRow[] => {
  const next = [...rows];
  const idx = next.findIndex((row) => normalizeMintUrl(row.url) === mintUrl);
  const current = next[idx];
  if (current !== undefined) {
    next[idx] = { ...current, ...fields, lastCheckedAtSec: nowSec };
    return next;
  }
  next.push({
    id: makeLocalId(),
    url: mintUrl,
    firstSeenAtSec: nowSec,
    lastSeenAtSec: nowSec,
    ...fields,
    lastCheckedAtSec: nowSec,
  });
  return next;
};

export const deletedMintInfoRows = (
  rows: readonly LocalMintInfoRow[],
  mintUrl: string,
): LocalMintInfoRow[] =>
  rows.map((row) =>
    normalizeMintUrl(row.url) === mintUrl
      ? { ...row, isDeleted: sqliteTrue }
      : row,
  );
