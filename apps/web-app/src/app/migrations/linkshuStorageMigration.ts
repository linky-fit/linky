// Legacy migration; removal gate in docs/architecture.md
//
// Carries a device's legacy cashu localStorage state to the key formats
// @linky/linkshu reads through the localStorage KeyValueStore adapter (#307).
// Both sides store the same "next unused derivation slot" accounting, so
// counters and restore cursors copy verbatim — a key rename, never a
// recomputation. Where a linkshu key already exists the existing value wins:
// post-cutover writes are fresher, and a re-run after a partial first run
// must not overwrite what that first run already copied.
//
// Legacy pending topup and autoswap-claim records convert into linkshu's
// pending-record format so its crash-resume path claims them — for a PAID
// but unclaimed quote the quote id is the only claim handle, so deleting the
// record would strand the payment. Claimed stashes and lock keys are deleted
// without conversion (the claimed stashes are drained by
// legacyAcceptedTokenDrain). The legacy seen-mints arrays are only read (the
// mints UI still owns them); linkshu's per-mint seen keys are seeded from
// them plus the mints of stored token rows.
//
// Removal requires the supported-upgrade evidence in docs/architecture.md.
// Keep the seed-bound wipe itself after removing its migration prologue.

import { parseMintUrl, parseTokenText } from "@linky/linkshu";
import { readField } from "../../utils/unknown";
import { asNonEmptyString } from "../../utils/validation";

const DONE_STORAGE_KEY = "linky.linkshu_storage_migration_v1";
const ROW_MINTS_DONE_STORAGE_KEY = "linky.linkshu_seen_mints_backfill_v1";

// Legacy writers (deleted in #300–#306): utils/cashuDeterministic.ts,
// app/lib/topupQuoteStorage.ts, app/lib/autoswapClaim.ts and
// useOwnerScopedStorage.ts in git history. Scoped keys were
// `<prefix>:<enc(mint)>:<enc(unit)>:<enc(keysetId)>` with the mint trimmed
// and stripped of trailing slashes before encodeURIComponent — the exact
// normalization linkshu's `parseMintUrl` applies, so segments carry over
// byte-for-byte.
const LEGACY_COUNTER_PREFIX = "linky.cashu.detCounter.v1:";
const LEGACY_RESTORE_CURSOR_PREFIX = "linky.cashu.restoreCursor.v1:";
const LEGACY_SEEN_MINTS_PREFIX = "linky.cashu.seenMints.v1.";
const LEGACY_PENDING_TOPUP_PREFIX = "linky.local.pendingTopupQuote.v1";
const LEGACY_PENDING_AUTOSWAP_PREFIX = "linky.local.pendingAutoswapClaim.v1";
const LEGACY_DELETE_ONLY_PREFIXES = [
  "linky.cashu.detCounterLock.v1",
  "linky.topup.claimed.v1",
  "linky.autoswap.claimed.v1",
  "linky.topup.claimLock.v1",
];

// linkshu's own keys as stored by makeLocalStorageKeyValueStore: the
// adapter's "linky.linkshu.value." prefix plus the package-internal
// dot-joined key. Both sides encode segments with encodeURIComponent (which
// escapes ":" but not "."), so mapping a legacy key is replacing its ":"
// separators with ".".
const LINKSHU_COUNTER_PREFIX = "linky.linkshu.value.linkshu.detCounter.";
const LINKSHU_RESTORE_CURSOR_PREFIX =
  "linky.linkshu.value.linkshu.restoreCursor.";
const LINKSHU_SEEN_MINTS_PREFIX = "linky.linkshu.value.linkshu.seenMints.";
const LINKSHU_PENDING_TOPUP_PREFIX =
  "linky.linkshu.value.linkshu.pendingTopup.";
const LINKSHU_PENDING_AUTOSWAP_PREFIX =
  "linky.linkshu.value.linkshu.pendingAutoswapClaim.";

// A syntactically valid keyset id for pending records whose device kept no
// legacy counter for the mint: the claim's collision recovery relocates the
// real slots via NUT-09, so a wrong counter scope self-heals at claim time.
const FALLBACK_KEYSET_ID = "00";

const snapshotStorageKeys = (): string[] => {
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key !== null) keys.push(key);
  }
  return keys;
};

const scopedSegmentsOf = (
  legacyKey: string,
  legacyPrefix: string,
): [string, string, string] | null => {
  const segments = legacyKey.slice(legacyPrefix.length).split(":");
  return segments.length === 3 &&
    segments[0] !== undefined &&
    segments[1] !== undefined &&
    segments[2] !== undefined
    ? [segments[0], segments[1], segments[2]]
    : null;
};

/**
 * Legacy pending records carry no keyset id, but linkshu's pending records
 * (and the counter scope its claim path locks) need one. The legacy counter
 * and restore-cursor keys are scoped by keyset, so they say which keyset the
 * device's wallet was bound to per mint+unit: counters win over cursors, and
 * the highest value wins among several keysets (the most recently used one).
 */
const buildLegacyKeysetLookup = (keys: string[]): Map<string, string> => {
  const best = new Map<string, { fromCounter: boolean; value: number }>();
  const lookup = new Map<string, string>();
  const consider = (
    key: string,
    prefix: string,
    fromCounter: boolean,
  ): void => {
    const segments = scopedSegmentsOf(key, prefix);
    if (segments === null) return;
    const scope = `${segments[0]}.${segments[1]}`;
    const parsed = Number(localStorage.getItem(key));
    const value = Number.isFinite(parsed) ? parsed : 0;
    const current = best.get(scope);
    if (
      current !== undefined &&
      (current.fromCounter !== fromCounter
        ? current.fromCounter
        : current.value >= value)
    ) {
      return;
    }
    best.set(scope, { fromCounter, value });
    lookup.set(scope, decodeURIComponent(segments[2]));
  };
  for (const key of keys) {
    if (key.startsWith(LEGACY_COUNTER_PREFIX)) {
      consider(key, LEGACY_COUNTER_PREFIX, true);
    } else if (key.startsWith(LEGACY_RESTORE_CURSOR_PREFIX)) {
      consider(key, LEGACY_RESTORE_CURSOR_PREFIX, false);
    }
  }
  return lookup;
};

const tryParseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

interface ConvertedPendingQuote {
  readonly quoteId: string;
  readonly mint: string;
  readonly unit: string;
  readonly keysetId: string;
  readonly amount: number;
  readonly invoice: string;
  readonly createdAt: number;
}

/**
 * The claim-relevant slice both linkshu pending records share, mapped from a
 * legacy pending topup-quote or autoswap-claim record. Null when a field the
 * linkshu schemas require cannot be recovered — such a record was never
 * claimable by the legacy code either.
 */
const convertPendingQuote = (
  value: unknown,
  keysetLookup: Map<string, string>,
): ConvertedPendingQuote | null => {
  const rawMint = asNonEmptyString(readField(value, "mintUrl"));
  const mint = rawMint === null ? null : parseMintUrl(rawMint);
  const quoteId = asNonEmptyString(readField(value, "quote"));
  const invoice = asNonEmptyString(readField(value, "invoice"));
  const amount = readField(value, "amount");
  const createdAtMs = readField(value, "createdAtMs");
  if (
    mint === null ||
    quoteId === null ||
    invoice === null ||
    !invoice.toLowerCase().startsWith("ln") ||
    typeof amount !== "number" ||
    !Number.isInteger(amount) ||
    amount <= 0 ||
    typeof createdAtMs !== "number" ||
    !Number.isFinite(createdAtMs)
  ) {
    return null;
  }
  const createdAt = Math.floor(createdAtMs / 1000);
  if (createdAt <= 0) return null;
  const unit = asNonEmptyString(readField(value, "unit")) ?? "sat";
  const scope = `${encodeURIComponent(mint)}.${encodeURIComponent(unit)}`;
  return {
    quoteId,
    mint,
    unit,
    keysetId: keysetLookup.get(scope) ?? FALLBACK_KEYSET_ID,
    amount,
    invoice,
    createdAt,
  };
};

const writePendingIfAbsent = (
  linkshuPrefix: string,
  converted: ConvertedPendingQuote,
  extraFields: Record<string, unknown>,
): void => {
  const targetKey =
    linkshuPrefix +
    [converted.mint, converted.quoteId].map(encodeURIComponent).join(".");
  if (localStorage.getItem(targetKey) !== null) return;
  localStorage.setItem(
    targetKey,
    JSON.stringify({
      quoteId: converted.quoteId,
      mint: converted.mint,
      unit: converted.unit,
      keysetId: converted.keysetId,
      amount: converted.amount,
      invoice: converted.invoice,
      ...extraFields,
      createdAt: converted.createdAt,
      // Null: no linkshu mint attempt has reserved counter slots yet, so the
      // resumed claim takes the fresh-claim path.
      mintCounter: null,
    }),
  );
};

const convertPendingTopupKey = (
  legacyKey: string,
  keysetLookup: Map<string, string>,
): void => {
  const raw = localStorage.getItem(legacyKey);
  if (raw !== null) {
    const converted = convertPendingQuote(tryParseJson(raw), keysetLookup);
    if (converted !== null) {
      // Legacy quotes stored no mint-stated expiry; linkshu applies its own
      // 24h poll deadline from createdAt, matching the legacy max age.
      writePendingIfAbsent(LINKSHU_PENDING_TOPUP_PREFIX, converted, {
        expiresAt: null,
      });
    }
  }
  localStorage.removeItem(legacyKey);
};

const convertPendingAutoswapKey = (
  legacyKey: string,
  keysetLookup: Map<string, string>,
): void => {
  const raw = localStorage.getItem(legacyKey);
  if (raw !== null) {
    const parsed = tryParseJson(raw);
    for (const entry of Array.isArray(parsed) ? parsed : []) {
      const converted = convertPendingQuote(entry, keysetLookup);
      if (converted !== null) {
        // The legacy record never stored the source mint; linkshu keeps it
        // for diagnostics only, so the target mint stands in.
        writePendingIfAbsent(LINKSHU_PENDING_AUTOSWAP_PREFIX, converted, {
          sourceMint: converted.mint,
        });
      }
    }
  }
  localStorage.removeItem(legacyKey);
};

const copyScopedValue = (
  legacyKey: string,
  legacyPrefix: string,
  linkshuPrefix: string,
): void => {
  const segments = scopedSegmentsOf(legacyKey, legacyPrefix);
  if (segments !== null) {
    const targetKey = linkshuPrefix + segments.join(".");
    const value = localStorage.getItem(legacyKey);
    if (value !== null && localStorage.getItem(targetKey) === null) {
      localStorage.setItem(targetKey, value);
    }
  }
  localStorage.removeItem(legacyKey);
};

const seedSeenMint = (candidate: string): void => {
  const mint = parseMintUrl(candidate);
  if (mint === null) return;
  const targetKey = LINKSHU_SEEN_MINTS_PREFIX + encodeURIComponent(mint);
  if (localStorage.getItem(targetKey) === null) {
    localStorage.setItem(targetKey, mint);
  }
};

const seedSeenMintsFromLegacyArray = (legacyKey: string): void => {
  const raw = localStorage.getItem(legacyKey);
  if (raw === null) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (!Array.isArray(parsed)) return;
  for (const entry of parsed) {
    if (typeof entry === "string") seedSeenMint(entry);
  }
};

/**
 * Runs once per device, before the linkshu runtime exists, so linkshu never
 * reads a deterministic counter or restore cursor that still lives under a
 * legacy key.
 */
export const migrateLegacyCashuLocalState = (): void => {
  try {
    if (localStorage.getItem(DONE_STORAGE_KEY) === "1") return;
    const keys = snapshotStorageKeys();
    // Before the loop below deletes the legacy counter keys the lookup reads.
    const keysetLookup = buildLegacyKeysetLookup(keys);
    for (const key of keys) {
      if (key.startsWith(LEGACY_COUNTER_PREFIX)) {
        copyScopedValue(key, LEGACY_COUNTER_PREFIX, LINKSHU_COUNTER_PREFIX);
      } else if (key.startsWith(LEGACY_RESTORE_CURSOR_PREFIX)) {
        copyScopedValue(
          key,
          LEGACY_RESTORE_CURSOR_PREFIX,
          LINKSHU_RESTORE_CURSOR_PREFIX,
        );
      } else if (key.startsWith(LEGACY_SEEN_MINTS_PREFIX)) {
        seedSeenMintsFromLegacyArray(key);
      } else if (key.startsWith(LEGACY_PENDING_TOPUP_PREFIX)) {
        convertPendingTopupKey(key, keysetLookup);
      } else if (key.startsWith(LEGACY_PENDING_AUTOSWAP_PREFIX)) {
        convertPendingAutoswapKey(key, keysetLookup);
      } else if (
        LEGACY_DELETE_ONLY_PREFIXES.some((prefix) => key.startsWith(prefix))
      ) {
        localStorage.removeItem(key);
      }
    }
    localStorage.setItem(DONE_STORAGE_KEY, "1");
  } catch {
    // Storage unavailable: retry next launch — every step is idempotent and
    // existing linkshu values are never overwritten.
  }
};

interface TokenRowMintSource {
  readonly mint: string | null;
  readonly rawToken: string | null;
  readonly token: string | null;
}

/**
 * Seeds linkshu's seen-mint keys from the mints of stored token rows, once
 * the first non-empty row set arrives. Timing is not critical: linkshu's
 * `collectKnownMints` already unions stored-row mints in at every read; this
 * only makes them durable should the rows later be deleted.
 */
export const seedLinkshuSeenMintsFromTokenRows = (
  rows: ReadonlyArray<TokenRowMintSource>,
): void => {
  try {
    if (rows.length === 0) return;
    if (localStorage.getItem(ROW_MINTS_DONE_STORAGE_KEY) === "1") return;
    for (const row of rows) {
      const tokenText = row.rawToken ?? row.token ?? "";
      const candidate =
        row.mint ?? (tokenText ? parseTokenText(tokenText)?.mint : null);
      if (typeof candidate === "string") seedSeenMint(candidate);
    }
    localStorage.setItem(ROW_MINTS_DONE_STORAGE_KEY, "1");
  } catch {
    // Storage unavailable: retry on the next rows change.
  }
};
