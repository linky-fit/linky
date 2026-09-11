import { Schema } from "effect";
import {
  Amount,
  CurrencyUnit,
  KeysetId,
  MintUrl,
  NonNegativeAmount,
  OperationId,
  TokenText,
  UnixSeconds,
} from "../domain/primitives";
import { OperationStatus } from "../ports/OperationStore";
import { ProofState } from "../ports/ProofStore";

/** The requested transfer transition is not legal from its status. */
export class InvalidTransferTransition extends Schema.TaggedError<InvalidTransferTransition>()(
  "InvalidTransferTransition",
  {
    operationId: OperationId,
    from: OperationStatus,
    to: OperationStatus,
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

/**
 * A token that crossed the wallet boundary as text: a `send` the wallet
 * issued, or a `receive` it accepted. Every field is safe to display; the
 * text itself carries the proofs and must stay out of logs.
 */
export class TokenTransfer extends Schema.Class<TokenTransfer>("TokenTransfer")(
  {
    id: OperationId,
    kind: Schema.Literal("send", "receive"),
    status: OperationStatus,
    tokenText: TokenText,
    mint: MintUrl,
    unit: CurrencyUnit,
    amount: Amount,
    /** Serialized tagged error of the last failure; null otherwise. */
    error: Schema.NullOr(Schema.String),
    createdAt: UnixSeconds,
  },
) {}

export class MintBalance extends Schema.Class<MintBalance>("MintBalance")({
  mint: MintUrl,
  amount: NonNegativeAmount,
}) {}

export class WalletBalances extends Schema.Class<WalletBalances>(
  "WalletBalances",
)({
  /** Sum over all `available` proofs across mints. */
  total: NonNegativeAmount,
  /**
   * Largest single-mint balance — the actually spendable figure, because
   * cashu cannot spend across mints in one operation.
   */
  spendable: NonNegativeAmount,
  perMint: Schema.Array(MintBalance),
}) {}

/** A proof restored from a backup exactly as the backup states it. */
export class ImportProofDraft extends Schema.Class<ImportProofDraft>(
  "ImportProofDraft",
)({
  mint: MintUrl,
  unit: CurrencyUnit,
  keysetId: KeysetId,
  amount: Amount,
  secret: Schema.NonEmptyString,
  C: Schema.String.pipe(Schema.pattern(/^(?:[0-9a-f]{2})+$/i)),
  dleq: Schema.NullOr(Schema.String),
  state: ProofState,
  operationId: Schema.NullOr(OperationId),
}) {}

/**
 * A token row of the pre-inventory storage model, as the web app's
 * `cashuToken` table and old backups still hold it. `Tokens.ingestLegacyRows`
 * turns it into proofs and operations.
 */
export class LegacyTokenRow extends Schema.Class<LegacyTokenRow>(
  "LegacyTokenRow",
)({
  id: Schema.NonEmptyTrimmedString,
  originalTokenText: TokenText,
  tokenText: TokenText,
  state: Schema.Literal(
    "pending",
    "accepted",
    "reserved",
    "issued",
    "externalized",
    "error",
  ),
  error: Schema.NullOr(Schema.String),
  createdAt: UnixSeconds,
}) {}
