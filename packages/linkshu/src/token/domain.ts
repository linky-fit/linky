import { Schema } from "effect";
import {
  Amount,
  CurrencyUnit,
  KeysetId,
  MintUrl,
  NonNegativeAmount,
  TokenRowId,
  TokenText,
  UnixSeconds,
} from "../domain/primitives";

/**
 * The token lifecycle owned by the package — every platform gets identical
 * transition semantics from a dumb row store:
 *
 * - `pending`       — in flight: an incoming token being accepted, or an
 *                     outgoing one (e.g. over a messenger) not yet confirmed
 *                     sent
 * - `accepted`      — spendable and owned; the row's `tokenText` holds fresh
 *                     post-swap proofs. Only `accepted` rows count as balance.
 * - `reserved`      — earmarked for handover, not yet issued
 * - `issued`        — emitted for someone else to claim (QR, share); watched
 *                     via NUT-07 and pruned once fully spent (= claimed)
 * - `externalized`  — handed off outside the app entirely
 * - `error`         — accept/validation failed; `error` holds the serialized
 *                     failure. Definitive failures ("already spent") mark the
 *                     row spent; transient ones never do.
 */
export const TokenState = Schema.Literal(
  "pending",
  "accepted",
  "reserved",
  "issued",
  "externalized",
  "error",
);
export type TokenState = typeof TokenState.Type;

/** The requested lifecycle transition is not legal from the row's state. */
export class InvalidTokenTransition extends Schema.TaggedError<InvalidTokenTransition>()(
  "InvalidTokenTransition",
  {
    rowId: TokenRowId,
    from: TokenState,
    to: TokenState,
  },
) {}

/**
 * A NUT-00 proof in linkshu's own serializable shape; `C` is the wire-format
 * field name. The token codec and SendReceipt expose these proofs.
 */
export class Proof extends Schema.Class<Proof>("Proof")({
  id: KeysetId,
  amount: Amount,
  secret: Schema.NonEmptyString,
  /** Hex-encoded signature point; byte-hex so v4 encoding is total. */
  C: Schema.String.pipe(Schema.pattern(/^(?:[0-9a-f]{2})+$/i)),
}) {}

/** Fully decoded single-mint token; the input/output of the canonical codec. */
export class DecodedToken extends Schema.Class<DecodedToken>("DecodedToken")({
  mint: MintUrl,
  unit: CurrencyUnit,
  memo: Schema.NullOr(Schema.String),
  proofs: Schema.NonEmptyArray(Proof),
}) {}

/**
 * Summary metadata of a token without exposing its proofs — what UIs need to
 * display an incoming token before deciding to receive it. `mint`/`unit` are
 * null when the encoding does not state them unambiguously.
 */
export class ParsedToken extends Schema.Class<ParsedToken>("ParsedToken")({
  amount: Amount,
  mint: Schema.NullOr(MintUrl),
  unit: Schema.NullOr(CurrencyUnit),
  memo: Schema.NullOr(Schema.String),
}) {}

/** A stored token row enriched with metadata derived from its token text. */
export class WalletToken extends Schema.Class<WalletToken>("WalletToken")({
  id: TokenRowId,
  state: TokenState,
  tokenText: TokenText,
  mint: Schema.NullOr(MintUrl),
  unit: Schema.NullOr(CurrencyUnit),
  amount: Amount,
  /** Serialized tagged error of the last failure; null outside `error`. */
  error: Schema.NullOr(Schema.String),
  createdAt: UnixSeconds,
}) {}

export class MintBalance extends Schema.Class<MintBalance>("MintBalance")({
  mint: MintUrl,
  amount: NonNegativeAmount,
}) {}

export class WalletBalances extends Schema.Class<WalletBalances>(
  "WalletBalances",
)({
  /** Sum over all `accepted` rows across mints. */
  total: NonNegativeAmount,
  /**
   * Largest single-mint balance — the actually spendable figure, because
   * cashu cannot spend across mints in one operation.
   */
  spendable: NonNegativeAmount,
  perMint: Schema.Array(MintBalance),
}) {}
