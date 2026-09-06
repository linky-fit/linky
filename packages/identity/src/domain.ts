import { validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { Schema } from "effect";
import { Slip39 } from "slip39-ts";

const bytesOfLength = (expected: number) =>
  Schema.Uint8ArrayFromSelf.pipe(
    Schema.filter((bytes) => bytes.length === expected, {
      description: `${expected} bytes`,
    }),
  );

export const toWords = (value: string): ReadonlyArray<string> =>
  value.split(/\s+/).filter((word) => word.length > 0);

const isNormalizedShare = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  if (!value) return false;
  if (value !== value.trim()) return false;
  if (value !== value.toLowerCase()) return false;
  if (/\s{2,}/.test(value)) return false;
  return toWords(value).length > 0;
};

const isSlip39Share = (value: unknown): value is string => {
  if (!isNormalizedShare(value)) return false;
  const words = toWords(value);
  if (words.length !== 20) return false;
  return Slip39.validateMnemonic(value);
};

const isBip39MnemonicWithWordCount =
  (expectedWordCount: number) =>
  (value: unknown): value is string => {
    if (typeof value !== "string") return false;
    const words = toWords(value);
    if (words.length !== expectedWordCount) return false;
    return validateMnemonic(words.join(" "), wordlist);
  };

export const MasterSecret = Schema.Uint8ArrayFromSelf.pipe(
  Schema.filter((bytes) => bytes.length >= 16 && bytes.length <= 64, {
    description: "16 to 64 bytes",
  }),
  Schema.brand("MasterSecret"),
);
export type MasterSecret = typeof MasterSecret.Type;

export const CashuSeed = bytesOfLength(64).pipe(Schema.brand("CashuSeed"));
export type CashuSeed = typeof CashuSeed.Type;

export const OwnerKey = bytesOfLength(16).pipe(Schema.brand("OwnerKey"));
export type OwnerKey = typeof OwnerKey.Type;

export const Slip39Share = Schema.String.pipe(
  Schema.filter(isSlip39Share),
).pipe(Schema.brand("Slip39Share"));
export type Slip39Share = typeof Slip39Share.Type;

export const Slip39Passphrase = Schema.String.pipe(
  Schema.brand("Slip39Passphrase"),
);
export type Slip39Passphrase = typeof Slip39Passphrase.Type;

export const OwnerLaneIndex = Schema.NonNegativeInt.pipe(
  Schema.brand("OwnerLaneIndex"),
);
export type OwnerLaneIndex = typeof OwnerLaneIndex.Type;

export const Bip39Mnemonic12 = Schema.String.pipe(
  Schema.filter(isBip39MnemonicWithWordCount(12)),
  Schema.brand("Bip39Mnemonic12"),
);
export type Bip39Mnemonic12 = typeof Bip39Mnemonic12.Type;

export const Bip39Mnemonic24 = Schema.String.pipe(
  Schema.filter(isBip39MnemonicWithWordCount(24)),
  Schema.brand("Bip39Mnemonic24"),
);
export type Bip39Mnemonic24 = typeof Bip39Mnemonic24.Type;

export const OwnerRole = Schema.Literal(
  "meta",
  "identity",
  "contacts",
  "cashu",
  "transactions",
  "messages",
);
export type OwnerRole = typeof OwnerRole.Type;
