import { Option, Schema } from "effect";
import { JsonValue } from "../../../types/json";
import { findMintInfoIconValue } from "@linky/linkshu";
import * as Evolu from "@evolu/common";
import type { CashuTokenRow } from "../../../evolu";
import {
  extractPpk,
  MAIN_MINT_URL,
  normalizeMintUrl,
} from "../../../utils/mint";
import { extractCashuTokenMeta } from "../../lib/tokenText";
import type { LocalMintInfoRow } from "../../types/appTypes";
import { isRecord } from "../../../utils/unknown";

interface MintInfoRowLike {
  feesJson?: LocalMintInfoRow["feesJson"];
  firstSeenAtSec?: LocalMintInfoRow["firstSeenAtSec"];
  id?: string | null;
  infoJson?: LocalMintInfoRow["infoJson"];
  isDeleted?: LocalMintInfoRow["isDeleted"];
  lastSeenAtSec?: LocalMintInfoRow["lastSeenAtSec"];
  supportsMpp?: LocalMintInfoRow["supportsMpp"];
  url?: string | null | undefined;
}

export const isMintDeletedRow = (row: MintInfoRowLike): boolean =>
  row.isDeleted === Evolu.sqliteTrue || row.isDeleted === "1";

const getLastSeenAtSec = (row: MintInfoRowLike): number =>
  (row.lastSeenAtSec ?? 0) || 0;

const hasJsonText = (value: string | null | undefined): boolean =>
  Boolean((value ?? "").trim().length);

const compareMintRows = (
  left: MintInfoRowLike,
  right: MintInfoRowLike,
): number => {
  const recencyDifference = getLastSeenAtSec(left) - getLastSeenAtSec(right);
  if (recencyDifference !== 0) return recencyDifference;

  const infoDifference =
    Number(hasJsonText(left.infoJson)) - Number(hasJsonText(right.infoJson));
  if (infoDifference !== 0) return infoDifference;

  return (
    Number(hasJsonText(left.feesJson)) - Number(hasJsonText(right.feesJson))
  );
};

const getCanonicalMintUrl = (row: MintInfoRowLike): string | null => {
  const raw = row.url ?? "";
  return normalizeMintUrl(raw);
};

export const getActiveMintInfoRows = (
  mintInfoAll: LocalMintInfoRow[],
): LocalMintInfoRow[] => {
  return [...mintInfoAll]
    .filter((row) => !isMintDeletedRow(row))
    .sort((a, b) => getLastSeenAtSec(b) - getLastSeenAtSec(a));
};

export const getMintInfoDedupedRows = (
  mintInfo: LocalMintInfoRow[],
  defaultMintUrl: string | null,
): Array<{ canonicalUrl: string; row: LocalMintInfoRow }> => {
  const bestByUrl = new Map<string, LocalMintInfoRow>();

  for (const row of mintInfo) {
    const key = getCanonicalMintUrl(row);
    if (!key) continue;

    const existing = bestByUrl.get(key);
    if (!existing) {
      bestByUrl.set(key, row);
      continue;
    }

    if (compareMintRows(row, existing) > 0) {
      bestByUrl.set(key, row);
    }
  }

  const main = normalizeMintUrl(defaultMintUrl ?? MAIN_MINT_URL);

  return Array.from(bestByUrl.entries())
    .sort((a, b) => {
      const aIsMain = main ? a[0] === main : false;
      const bIsMain = main ? b[0] === main : false;
      if (aIsMain !== bIsMain) return aIsMain ? -1 : 1;
      return getLastSeenAtSec(b[1]) - getLastSeenAtSec(a[1]);
    })
    .map(([canonicalUrl, row]) => ({ canonicalUrl, row }));
};

export const getMintInfoByUrlMap = (
  mintInfoAll: LocalMintInfoRow[],
): Map<string, LocalMintInfoRow> => {
  const map = new Map<string, LocalMintInfoRow>();

  for (const row of mintInfoAll) {
    const url = getCanonicalMintUrl(row);
    if (!url) continue;

    const existing = map.get(url);
    if (!existing) {
      map.set(url, row);
      continue;
    }

    const existingDeleted = isMintDeletedRow(existing);
    const rowDeleted = isMintDeletedRow(row);
    if (existingDeleted && !rowDeleted) {
      map.set(url, row);
    }
  }

  return map;
};

export const getEncounteredMintUrls = (
  cashuTokensAll: readonly CashuTokenRow[],
): string[] => {
  const set = new Set<string>();

  for (const row of cashuTokensAll) {
    const state = row.state ?? "";
    if (state !== "accepted") continue;

    const mint = extractCashuTokenMeta(row).mint;
    const normalized = normalizeMintUrl(mint);
    if (normalized) set.add(normalized);
  }

  return Array.from(set.values()).sort();
};

const toJson = (value: unknown): string | null => {
  try {
    const text = JSON.stringify(value);
    const trimmed = text.trim();
    if (
      !trimmed ||
      trimmed === "null" ||
      trimmed === "{}" ||
      trimmed === "[]"
    ) {
      return null;
    }

    return trimmed.slice(0, 1000);
  } catch {
    return null;
  }
};

export const getMintInfoIconUrl = (
  mintUrl: string | null | undefined,
  infoJson: string | null | undefined,
): string | null => {
  const infoText = (infoJson ?? "").trim();
  if (!infoText) return null;

  const normalizedMintUrl = normalizeMintUrl(mintUrl);
  if (!normalizedMintUrl) return null;

  let info: unknown;
  try {
    info = JSON.parse(infoText);
  } catch {
    return null;
  }

  const rawIcon = findMintInfoIconValue(info, new Set());
  if (!rawIcon) return null;

  try {
    return new URL(rawIcon, normalizedMintUrl).toString();
  } catch {
    return null;
  }
};

// Fees are not part of NUT-06 info; the only published fee is the active
// keyset's input_fee_ppk from /v1/keysets.
export const extractActiveKeysetPpk = (
  keysetsPayload: unknown,
  unit = "sat",
): number | null => {
  const decoded = Schema.decodeUnknownOption(
    Schema.Struct({
      keysets: Schema.Array(Schema.Unknown),
    }),
  )(keysetsPayload);
  if (Option.isNone(decoded)) return null;
  const keysetSchema = Schema.Struct({
    active: Schema.Boolean,
    unit: Schema.String,
    input_fee_ppk: Schema.optionalWith(Schema.Int.pipe(Schema.nonNegative()), {
      default: () => 0,
    }),
  });
  const fees = decoded.value.keysets.flatMap((value) => {
    const keyset = Schema.decodeUnknownOption(keysetSchema)(value);
    return Option.isSome(keyset) &&
      keyset.value.active &&
      keyset.value.unit === unit
      ? [keyset.value.input_fee_ppk]
      : [];
  });
  return fees.length ? Math.min(...fees) : null;
};

export const parseMintInfoPayload = (
  info: unknown,
  keysetsPayload?: unknown,
): {
  feesJson: string | null;
  infoJson: string | null;
  supportsMpp: string | null;
} => {
  const decodeRecord = Schema.decodeUnknownOption(
    Schema.Record({ key: Schema.String, value: JsonValue }),
  );
  const payload = Option.getOrNull(decodeRecord(info));
  const nuts = Option.getOrNull(decodeRecord(payload?.nuts ?? payload?.NUTS));
  const nut15 = nuts?.["15"] ?? nuts?.nut15 ?? nuts?.NUT15 ?? null;
  const feesRaw = payload?.fees ?? payload?.fee ?? null;
  const ppk =
    extractActiveKeysetPpk(keysetsPayload) ??
    extractPpk(feesRaw) ??
    extractPpk(payload);
  const fees = ppk !== null ? { ppk, raw: feesRaw } : feesRaw;

  return {
    supportsMpp: nut15 ? "1" : null,
    feesJson: toJson(fees),
    infoJson: toJson(info),
  };
};

interface DuplicateRow extends MintInfoRowLike {
  id: string;
  url: string;
}

interface DuplicateGroup {
  key: string;
  rows: DuplicateRow[];
}

const getDuplicateGroups = (
  mintInfoAll: LocalMintInfoRow[],
): DuplicateGroup[] => {
  const active = mintInfoAll.filter((row) => !isMintDeletedRow(row));
  if (active.length < 2) return [];

  const grouped = new Map<string, DuplicateRow[]>();
  for (const row of active) {
    const key = getCanonicalMintUrl(row);
    const id = row.id;
    if (!key || !id) continue;
    const existing = grouped.get(key);
    const withTypes = {
      ...row,
      id,
      url: row.url,
    };
    if (existing) existing.push(withTypes);
    else grouped.set(key, [withTypes]);
  }

  return Array.from(grouped.entries())
    .filter(([, rows]) => rows.length > 1)
    .map(([key, rows]) => ({ key, rows }));
};

const chooseBestDuplicateRow = (rows: DuplicateRow[]): DuplicateRow => {
  return [...rows].sort((a, b) => compareMintRows(b, a))[0];
};

export const buildMintDedupeSignature = (
  mintInfoAll: LocalMintInfoRow[],
): string => {
  const groups = getDuplicateGroups(mintInfoAll);
  return groups
    .map(
      ({ key, rows }) =>
        `${key}:${rows
          .map((row) => row.id)
          .sort()
          .join(",")}`,
    )
    .sort()
    .join("|");
};

export const dedupeMintInfoRows = (
  mintInfoAll: LocalMintInfoRow[],
): LocalMintInfoRow[] | null => {
  const groups = getDuplicateGroups(mintInfoAll);
  if (groups.length === 0) return null;

  const next = [...mintInfoAll];
  let didChange = false;

  const applyPatch = (patch: Partial<LocalMintInfoRow> & { id: string }) => {
    const id = patch.id;
    if (!id) return;

    const idx = next.findIndex((row) => row.id === id);
    if (idx < 0) return;

    next[idx] = { ...next[idx], ...patch };
    didChange = true;
  };

  for (const { key, rows } of groups) {
    const best = chooseBestDuplicateRow(rows);

    const bestUrl = normalizeMintUrl(best.url);
    if (bestUrl && bestUrl !== key) {
      applyPatch({ id: best.id, url: key });
    }

    for (const row of rows) {
      if (row.id === best.id) continue;
      applyPatch({ id: row.id, isDeleted: Evolu.sqliteTrue });
    }
  }

  return didChange ? next : null;
};

export const getMintFeePpk = (
  feesJson: string | null | undefined,
): number | null => {
  const text = (feesJson ?? "").trim();
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) return null;
    const ppk = parsed.ppk;
    return typeof ppk === "number" && Number.isFinite(ppk) ? ppk : null;
  } catch {
    return null;
  }
};
