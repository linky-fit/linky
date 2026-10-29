import { createIdFromString } from "@linky-fit/domain";
import { isTestMintUrl, parseMintUrl } from "@linky-fit/linkshu";
import {
  NonEmptyString100,
  NonEmptyString1000,
  type ShardDbError,
} from "@linky-fit/linksync";
import { Effect } from "effect";
import type { SettingsRepository } from "./shop";

const MINT_KEY = "fazole.mintUrl";
// Mirrors linksync's `settingIdFor`, whose keys are Linky's own settings only.
export const mintSettingId = createIdFromString<"Setting">(
  `setting/${MINT_KEY}`,
);

/** Mints offered to every shop, the recommended one first; Linky lists the same ones. */
export const PRODUCTION_MINTS: readonly string[] = [
  "https://cashu.cz",
  "https://mint.minibits.cash/Bitcoin",
  "https://kashu.me",
  "https://cashu.21m.lol",
];

/** The mint new payments are minted at; the config's until the merchant picks another. */
export const readMintUrl = (
  settings: SettingsRepository,
  defaultMintUrl: string,
): Effect.Effect<string> =>
  Effect.map(settings.byId(mintSettingId), (row) => {
    const value = row?.value ?? null;
    return value !== null && parseMintUrl(value) !== null
      ? value
      : defaultMintUrl;
  });

export const saveMintUrl = (
  settings: SettingsRepository,
  mintUrl: string,
): Effect.Effect<void, ShardDbError> =>
  settings.insert({
    id: mintSettingId,
    key: NonEmptyString100.orThrow(MINT_KEY),
    value: NonEmptyString1000.orThrow(mintUrl),
  });

/** A mint as the merchant typed it, a bare host included; `null` when it is no mint URL. */
export const parseMintUrlInput = (value: string): string | null => {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  const mint = parseMintUrl(withScheme);
  if (mint === null) return null;
  try {
    const { hostname } = new URL(mint);
    return hostname.includes(".") || isTestMintUrl(mint) ? mint : null;
  } catch {
    return null;
  }
};

/**
 * The mints the settings offer: the presets (a development mint replaces them
 * when the config names one), the selected mint and every mint the wallet
 * holds sats at, without duplicates; a test mint shows only when the config
 * points at one.
 */
export const offeredMints = ({
  defaultMintUrl,
  selectedMintUrl,
  fundedMints,
}: {
  readonly defaultMintUrl: string;
  readonly selectedMintUrl: string;
  readonly fundedMints: readonly string[];
}): readonly string[] => {
  const developmentMint = isTestMintUrl(defaultMintUrl);
  const presets = developmentMint ? [defaultMintUrl] : PRODUCTION_MINTS;
  return [...presets, selectedMintUrl, ...fundedMints]
    .map((mint) => parseMintUrl(mint) ?? mint)
    .filter(
      (mint, index, all) =>
        all.indexOf(mint) === index &&
        (developmentMint || !isTestMintUrl(mint)),
    );
};
