import { CZECH_FIRST_NAMES, ENGLISH_FIRST_NAMES } from "./firstNames";
import type { Lang } from "./i18n";

export interface DerivedProfileDefaults {
  lnAddress: string;
  name: string;
  pictureUrl: string;
}

export const DEFAULT_LIGHTNING_ADDRESS_DOMAIN = "linky.fit";

// Simple deterministic hash (FNV-1a 32-bit) that works synchronously in the browser.
const hash32 = (input: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // hash *= 16777619 (via shifts to stay in 32-bit)
    hash =
      (hash +
        ((hash << 1) >>> 0) +
        ((hash << 4) >>> 0) +
        ((hash << 7) >>> 0) +
        ((hash << 8) >>> 0) +
        ((hash << 24) >>> 0)) >>
      0;
  }
  return hash >>> 0;
};

export const buildLoreleiAvatarUrl = (seed: string): string => {
  const params = new URLSearchParams({
    seed: seed.trim() || "linky",
    backgroundColor: "b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf",
  });
  return `https://api.dicebear.com/9.x/lorelei/svg?${params.toString()}`;
};

const pickDeterministicName = (npub: string, lang: Lang): string => {
  const key = npub.trim();
  const list = lang === "cs" ? CZECH_FIRST_NAMES : ENGLISH_FIRST_NAMES;
  if (!key) return list[0] ?? "Linky";
  if (!list.length) return "Linky";
  const idx = hash32(key) % list.length;
  return list[idx] ?? list[0] ?? "Linky";
};

export const deriveDefaultLightningAddress = (npub: string): string => {
  const normalized = npub.trim();
  return normalized ? `${normalized}@${DEFAULT_LIGHTNING_ADDRESS_DOMAIN}` : "";
};

export const parseDefaultLightningAddressNpub = (
  lightningAddress: string,
): string | null => {
  const normalized = lightningAddress.trim();
  const suffix = `@${DEFAULT_LIGHTNING_ADDRESS_DOMAIN}`;
  if (!normalized.toLowerCase().endsWith(suffix)) return null;
  const npub = normalized.slice(0, -suffix.length).trim();
  return npub || null;
};

export const omitSyntheticContactLightningAddress = (
  lightningAddress: string,
  npub: string,
): string => {
  const normalizedLightningAddress = lightningAddress.trim();
  if (!normalizedLightningAddress) return "";

  const normalizedNpub = npub.trim().toLowerCase();
  if (!normalizedNpub) return normalizedLightningAddress;

  const defaultLightningAddressNpub = parseDefaultLightningAddressNpub(
    normalizedLightningAddress,
  );
  if (!defaultLightningAddressNpub) return normalizedLightningAddress;

  return defaultLightningAddressNpub.trim().toLowerCase() === normalizedNpub
    ? ""
    : normalizedLightningAddress;
};

export const deriveDefaultProfile = (
  npub: string,
  lang: Lang = "en",
): DerivedProfileDefaults => {
  const normalized = npub.trim();
  const name = pickDeterministicName(normalized, lang);
  const pictureUrl = buildLoreleiAvatarUrl(normalized);
  const lnAddress = deriveDefaultLightningAddress(normalized);
  return { name, lnAddress, pictureUrl };
};
