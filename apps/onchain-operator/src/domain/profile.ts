import {
  ClientVersion,
  DEFAULT_TRANSFER_AMOUNTS,
  parseDepositXpub,
  type BitcoinNetwork,
  type OnchainConfig,
} from "@linky-fit/onchain-transfer";
import { encodeNpub, type Pubkey } from "@linky-fit/linkstr";
import { Result, Schema } from "effect";
import { parseWatchers } from "./watchers";

/** The operator's terms and deposit key, kept private in the synced settings. */
export interface OperatorProfile {
  /** The name the operator's Nostr profile shows Linky users. */
  readonly name: string;
  /** BIP86 account-level xpub (tpub on test networks) deposit addresses derive from. */
  readonly xpub: string;
  readonly feeBasisPoints: number;
  readonly paused: boolean;
  readonly description: string;
  readonly amounts: readonly [number, ...number[]];
  /** The oldest Linky version that may make transfers; `null` for any. */
  readonly minClientVersion: string | null;
  /** Who hears in Linky about whatever waits for the operator. */
  readonly watchers: readonly Pubkey[];
  /** The https URL of the Nostr profile picture. */
  readonly picture: string | null;
}

/** What the settings form edits; the picture is saved on its own. */
export type EditedProfile = Omit<OperatorProfile, "picture">;

/** The settings form as typed; the fee is in percent. */
export interface ProfileForm {
  readonly name: string;
  readonly xpub: string;
  readonly feePercent: string;
  readonly paused: boolean;
  readonly description: string;
  readonly amounts: string;
  readonly minClientVersion: string;
  readonly watchers: string;
}

export type ProfileFormErrors = Partial<
  Record<
    | "name"
    | "xpub"
    | "feePercent"
    | "description"
    | "amounts"
    | "minClientVersion"
    | "watchers",
    "invalid"
  >
>;

export const DEFAULT_OPERATOR_NAME = "Linky support";
const NAME_MAX_LENGTH = 100;
const DESCRIPTION_MAX_LENGTH = 1000;
const MAX_FEE_BASIS_POINTS = 10_000;
const CLIENT_VERSION_MAX_LENGTH = 20;

/** Basis points as percent text: 100 is "1", 25 is "0.25". */
export const feePercentText = (basisPoints: number): string =>
  String(basisPoints / 100);

/** Percent with up to two decimals, a comma or a dot, as basis points; `null` when it is not one. */
export const parseFeePercent = (text: string): number | null => {
  const match = /^(\d{1,3})(?:[.,](\d{1,2}))?$/u.exec(text.trim());
  if (match === null) return null;
  const basisPoints =
    Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return basisPoints <= MAX_FEE_BASIS_POINTS ? basisPoints : null;
};

/** Amounts in sats separated by commas, semicolons or line breaks; spaces inside a number are ignored. */
export const parseAmounts = (
  text: string,
): readonly [number, ...number[]] | null => {
  const parts = text
    .split(/[,;\n]/u)
    .map((part) => part.replace(/[\s_]/gu, ""))
    .filter((part) => part !== "");
  if (parts.length === 0 || parts.some((part) => !/^[1-9]\d*$/u.test(part)))
    return null;
  const [first, ...rest] = [...new Set(parts.map(Number))].sort(
    (a, b) => a - b,
  );
  return first === undefined || !Number.isSafeInteger(rest.at(-1) ?? first)
    ? null
    : [first, ...rest];
};

/** A Linky version, `null` for no minimum; `undefined` when it is not one. */
export const parseMinClientVersion = (
  text: string,
): string | null | undefined => {
  const version = text.trim();
  if (version === "") return null;
  return Schema.is(ClientVersion)(version) &&
    version.length <= CLIENT_VERSION_MAX_LENGTH
    ? version
    : undefined;
};

export const profileForm = (profile: EditedProfile | null): ProfileForm => ({
  name: profile?.name ?? DEFAULT_OPERATOR_NAME,
  xpub: profile?.xpub ?? "",
  feePercent: feePercentText(profile?.feeBasisPoints ?? 100),
  paused: profile?.paused ?? false,
  description: profile?.description ?? "",
  amounts: (profile?.amounts ?? DEFAULT_TRANSFER_AMOUNTS).join(", "),
  minClientVersion: profile?.minClientVersion ?? "",
  watchers: (profile?.watchers ?? []).map(encodeNpub).join("\n"),
});

export const parseProfileForm = (
  form: ProfileForm,
  network: BitcoinNetwork,
): Result.Result<EditedProfile, ProfileFormErrors> => {
  const xpub = parseDepositXpub(form.xpub, network);
  const feeBasisPoints = parseFeePercent(form.feePercent);
  const amounts = parseAmounts(form.amounts);
  const minClientVersion = parseMinClientVersion(form.minClientVersion);
  const watchers = parseWatchers(form.watchers);
  const name = form.name.trim();
  const nameFits = name !== "" && name.length <= NAME_MAX_LENGTH;
  const description = form.description.trim();
  const descriptionFits = description.length <= DESCRIPTION_MAX_LENGTH;
  if (
    !nameFits ||
    xpub === null ||
    feeBasisPoints === null ||
    amounts === null ||
    minClientVersion === undefined ||
    watchers === null ||
    !descriptionFits
  ) {
    return Result.fail({
      ...(nameFits ? {} : { name: "invalid" }),
      ...(xpub === null ? { xpub: "invalid" } : {}),
      ...(feeBasisPoints === null ? { feePercent: "invalid" } : {}),
      ...(amounts === null ? { amounts: "invalid" } : {}),
      ...(minClientVersion === undefined
        ? { minClientVersion: "invalid" }
        : {}),
      ...(watchers === null ? { watchers: "invalid" } : {}),
      ...(descriptionFits ? {} : { description: "invalid" }),
    });
  }
  return Result.succeed({
    name,
    xpub,
    feeBasisPoints,
    paused: form.paused,
    description,
    amounts,
    minClientVersion,
    watchers,
  });
};

/** The public on-chain config the profile publishes; the mint, network and explorer come from the app config. */
export const onchainConfigOf = (
  profile: EditedProfile,
  config: {
    readonly mintUrl: string;
    readonly network: BitcoinNetwork;
    readonly explorerUrl: string;
  },
): OnchainConfig => ({
  v: 1,
  feeBasisPoints: profile.feeBasisPoints,
  paused: profile.paused,
  description: profile.description,
  amounts: profile.amounts,
  mintUrl: config.mintUrl,
  network: config.network,
  explorerUrl: config.explorerUrl,
  ...(profile.minClientVersion === null
    ? {}
    : { minClientVersion: profile.minClientVersion }),
});
