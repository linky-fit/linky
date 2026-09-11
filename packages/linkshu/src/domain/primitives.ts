import { Schema } from "effect";

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname.length > 0
    );
  } catch {
    return false;
  }
};

/**
 * Mint identity. Compare and store only the normalized form (no trailing
 * slash) produced by `parseMintUrl`, or two spellings of one mint fork the
 * wallet's counters and instance cache.
 */
export const MintUrl = Schema.NonEmptyTrimmedString.pipe(
  Schema.filter(isHttpUrl, {
    description: "an http:// or https:// url with a host",
  }),
  Schema.filter((value) => !value.endsWith("/"), {
    description: "a normalized mint url without a trailing slash",
  }),
  Schema.brand("MintUrl"),
);
export type MintUrl = typeof MintUrl.Type;

/** Cashu currency unit ("sat"). Linky wallets are sat-denominated today. */
export const CurrencyUnit = Schema.NonEmptyTrimmedString.pipe(
  Schema.brand("CurrencyUnit"),
);
export type CurrencyUnit = typeof CurrencyUnit.Type;

/** Hex-encoded keyset id bytes; even length so v4 byte encoding is total. */
export const KeysetId = Schema.String.pipe(
  Schema.pattern(/^(?:[0-9a-f]{2})+$/i),
  Schema.brand("KeysetId"),
);
export type KeysetId = typeof KeysetId.Type;

/**
 * A serialized cashu token ("cashuA…"/"cashuB…"). The canonical currency of
 * the public API: operations take and return token text, never raw proofs.
 */
export const TokenText = Schema.NonEmptyTrimmedString.pipe(
  Schema.startsWith("cashu"),
  Schema.brand("TokenText"),
);
export type TokenText = typeof TokenText.Type;

export const Bolt11Invoice = Schema.NonEmptyTrimmedString.pipe(
  Schema.filter((value) => value.toLowerCase().startsWith("ln"), {
    description: "a bolt11 lightning invoice",
  }),
  Schema.brand("Bolt11Invoice"),
);
export type Bolt11Invoice = typeof Bolt11Invoice.Type;

/** A token amount in the wallet unit; always positive. */
export const Amount = Schema.Int.pipe(
  Schema.positive(),
  Schema.brand("Amount"),
);
export type Amount = typeof Amount.Type;

/** A fee or balance in the wallet unit; may be zero. */
export const NonNegativeAmount = Schema.Int.pipe(
  Schema.nonNegative(),
  Schema.brand("NonNegativeAmount"),
);
export type NonNegativeAmount = typeof NonNegativeAmount.Type;

/** Mint- or melt-quote id issued by a mint. */
export const QuoteId = Schema.NonEmptyTrimmedString.pipe(
  Schema.brand("QuoteId"),
);
export type QuoteId = typeof QuoteId.Type;

/**
 * Id of a stored proof row. The `ProofStore` derives it from the proof's
 * secret, so every device that stores one proof stores it under one id.
 */
export const ProofId = Schema.NonEmptyTrimmedString.pipe(
  Schema.brand("ProofId"),
);
export type ProofId = typeof ProofId.Type;

/**
 * Id of a stored operation. The `OperationStore` derives it from the
 * operation's key (`operationKeyOf`): the token text of a transfer, the
 * quote of a mint or melt.
 */
export const OperationId = Schema.NonEmptyTrimmedString.pipe(
  Schema.brand("OperationId"),
);
export type OperationId = typeof OperationId.Type;

/** Deterministic-derivation counter position (NUT-13); per mint/unit/keyset. */
export const DeterministicCounter = Schema.Int.pipe(
  Schema.nonNegative(),
  Schema.brand("DeterministicCounter"),
);
export type DeterministicCounter = typeof DeterministicCounter.Type;

export const UnixSeconds = Schema.Int.pipe(
  Schema.positive(),
  Schema.brand("UnixSeconds"),
);
export type UnixSeconds = typeof UnixSeconds.Type;

/** The 64-byte BIP-39 seed all deterministic derivations hang off. */
export const Bip39Seed = Schema.Uint8ArrayFromSelf.pipe(
  Schema.filter((bytes) => bytes.length === 64, {
    description: "a 64-byte bip39 seed",
  }),
  Schema.brand("Bip39Seed"),
);
export type Bip39Seed = typeof Bip39Seed.Type;

const decodeMintUrl = Schema.decodeUnknownOption(MintUrl);

/** Normalizes (trim, strip trailing slashes) and validates a mint url. */
export const parseMintUrl = (value: string): MintUrl | null => {
  const normalized = value.trim().replace(/\/+$/, "");
  const decoded = decodeMintUrl(normalized);
  return decoded._tag === "Some" ? decoded.value : null;
};
