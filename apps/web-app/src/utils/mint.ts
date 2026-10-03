export interface MintIcon {
  failed: boolean;
  host: string | null;
  origin: string | null;
  url: string | null;
}

import { isTestMintUrl as sharedIsTestMintUrl } from "@linky-fit/linkshu";
import { GENERIC_MINT_ICON_DATA_URL } from "@linky-fit/linkshu";
import { PRODUCTION_MINTS } from "@linky-fit/supporter";
export {
  GENERIC_MINT_ICON_DATA_URL,
  getMintIconOverride,
} from "@linky-fit/linkshu";
const envMainMintUrl = (import.meta.env.VITE_MAIN_MINT_URL ?? "").trim();

/** Where funds go when the configured default mint is a hidden test mint. */
export const FALLBACK_PRODUCTION_MINT_URL = "https://cashu.cz";

export const MAIN_MINT_URL = envMainMintUrl || FALLBACK_PRODUCTION_MINT_URL;

export { PRODUCTION_MINTS };

// An explicit development mint keeps preset discovery and recovery local.
export const PRESET_MINTS = envMainMintUrl
  ? [envMainMintUrl]
  : [
      PRODUCTION_MINTS[0],
      "https://testnut.cashu.space",
      ...PRODUCTION_MINTS.slice(1),
    ];

export const CASHU_DEFAULT_MINT_OVERRIDE_STORAGE_KEY =
  "linky.cashu.defaultMintOverride.v1";

export const CASHU_SEEN_MINTS_STORAGE_KEY = "linky.cashu.seenMints.v1";

interface MintStructuredValue {
  toString(): string;
}

type MintStringInput =
  | bigint
  | boolean
  | number
  | MintStructuredValue
  | string
  | symbol
  | null
  | undefined;

type PpkSearchPrimitive =
  | bigint
  | boolean
  | number
  | MintStructuredValue
  | string
  | symbol
  | null
  | undefined;

interface PpkSearchRecord {
  [key: string]: PpkSearchValue;
}

type PpkSearchValue = PpkSearchPrimitive | PpkSearchRecord | PpkSearchValue[];

const isPpkSearchBranch = (
  value: PpkSearchValue,
): value is PpkSearchRecord | PpkSearchValue[] => {
  return typeof value === "object" && value !== null;
};

const getPpkEntries = (
  value: PpkSearchRecord | PpkSearchValue[],
): Array<[string, PpkSearchValue]> => {
  if (Array.isArray(value)) {
    return value.map((inner, index) => [String(index), inner]);
  }
  return Object.entries(value);
};

export const normalizeMintUrl = (value: MintStringInput): string => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const stripped = raw.replace(/\/+$/, "");

  try {
    const u = new URL(stripped);
    const host = u.host.toLowerCase();
    const pathname = u.pathname.replace(/\/+$/, "");

    // Canonicalize our main mint: always use the /Bitcoin variant.
    if (host === "mint.minibits.cash") {
      return "https://mint.minibits.cash/Bitcoin";
    }

    // Keep path for other mints (some are hosted under a path), but drop
    // search/hash for stable identity.
    return `${u.origin}${pathname}`.replace(/\/+$/, "");
  } catch {
    return stripped;
  }
};

export const getMintOriginAndHost = (
  mint: MintStringInput,
): { origin: string | null; host: string | null } => {
  const raw = String(mint ?? "").trim();
  if (!raw) return { origin: null, host: null };
  try {
    const u = new URL(raw);
    return { origin: u.origin, host: u.host };
  } catch {
    const candidate = raw.match(/^https?:\/\//i) ? raw : `https://${raw}`;
    try {
      const u = new URL(candidate);
      return { origin: u.origin, host: u.host };
    } catch {
      return { origin: null, host: raw };
    }
  }
};

export const isTestMintUrl = (mint: MintStringInput): boolean =>
  sharedIsTestMintUrl(normalizeMintUrl(mint));

/** A test mint while the "Allow test mints" setting is off: never shown, used, or accepted. */
export const isHiddenTestMint = (
  mint: string | null | undefined,
  allowTestMints: boolean,
): boolean => !allowTestMints && isTestMintUrl(mint);

/**
 * The default mint the wallet uses. A hidden test mint (or no stored choice
 * while the build's main mint is one) falls back to the first production mint;
 * the stored preference is left as is.
 */
export const effectiveDefaultMintUrl = (
  storedMintUrl: string | null,
  allowTestMints: boolean,
): string | null =>
  isHiddenTestMint(storedMintUrl ?? MAIN_MINT_URL, allowTestMints)
    ? FALLBACK_PRODUCTION_MINT_URL
    : storedMintUrl;

export const getNextMintIconUrl = (
  currentUrl: string | null,
  origin: string | null,
): string | null => {
  const genericUrl = GENERIC_MINT_ICON_DATA_URL;
  const cleanedCurrentUrl = (currentUrl ?? "").trim() || null;
  const faviconUrl = origin ? `${origin}/favicon.ico` : null;

  if (faviconUrl && cleanedCurrentUrl !== faviconUrl) {
    return faviconUrl;
  }

  if (cleanedCurrentUrl !== genericUrl) {
    return genericUrl;
  }

  return null;
};

export const extractPpk = (value: PpkSearchValue): number | null => {
  const seen = new Set<PpkSearchRecord | PpkSearchValue[]>();
  const queue: Array<{ depth: number; value: PpkSearchValue }> = [
    { value, depth: 0 },
  ];

  while (queue.length) {
    const item = queue.shift();
    if (!item) break;
    const { depth, value: current } = item;
    if (!isPpkSearchBranch(current)) continue;
    if (seen.has(current)) continue;
    seen.add(current);

    for (const [key, inner] of getPpkEntries(current)) {
      if (key.toLowerCase() === "ppk") {
        if (typeof inner === "number" && Number.isFinite(inner)) return inner;
        const num = Number(String(inner ?? "").trim());
        if (Number.isFinite(num)) return num;
      }
      if (depth < 3 && isPpkSearchBranch(inner)) {
        queue.push({ value: inner, depth: depth + 1 });
      }
    }
  }
  return null;
};

/** The mint url as the mints list names it: without the scheme, path kept. */
export const formatMintLabel = (mintUrl: string): string =>
  mintUrl.replace(/^https?:\/\//i, "");

export type MintBadgeKind = "default" | "recommended" | "test";

const RECOMMENDED_MINT_URL = "https://cashu.cz";

/** The badge the mints list shows next to a mint, if any. */
export const mintKindBadge = (mintUrl: string): MintBadgeKind | null => {
  if (isTestMintUrl(mintUrl)) return "test";
  return normalizeMintUrl(mintUrl) === RECOMMENDED_MINT_URL
    ? "recommended"
    : null;
};

export const formatMintHost = (mintUrl: string): string => {
  const withoutScheme = mintUrl.replace(/^https?:\/\//i, "");
  try {
    return new URL(mintUrl).host || withoutScheme;
  } catch {
    return withoutScheme;
  }
};
