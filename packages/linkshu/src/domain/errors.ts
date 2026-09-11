import { Schema } from "effect";
import {
  Amount,
  CurrencyUnit,
  KeysetId,
  MintUrl,
  NonNegativeAmount,
  OperationId,
  QuoteId,
} from "./primitives";

/**
 * Every failure the package reports is a `Schema.TaggedError`: serializable
 * by design so callers can persist it (operations carry their last failure),
 * branch on `_tag`, and render it without string matching.
 *
 * The split between `MintUnreachable` (transient: network, timeout, 5xx —
 * retry later, never mark state) and `MintRejected` (definitive protocol
 * rejection) is the package's error-classification rule; internals map raw
 * cashu-ts/mint failures onto it and the raw error never crosses the
 * boundary.
 */

/** No token found in the given text, or the token could not be decoded. */
export class TokenParseFailed extends Schema.TaggedError<TokenParseFailed>()(
  "TokenParseFailed",
  {
    reason: Schema.Literal(
      "empty",
      "no-token-found",
      "undecodable",
      "no-proofs",
      "multiple-mints",
    ),
    detail: Schema.NullOr(Schema.String),
  },
) {}

/**
 * Dedup: this token is already in the wallet — a transfer with the same text
 * exists (`operationId`), or its proofs are already stored (`operationId`
 * null: the funds are in the inventory, no transfer names the text).
 */
export class TokenAlreadyKnown extends Schema.TaggedError<TokenAlreadyKnown>()(
  "TokenAlreadyKnown",
  {
    operationId: Schema.NullOr(OperationId),
  },
) {}

/** The mint definitively reported the proofs as spent (NUT-07 / code 11001). */
export class TokenAlreadySpent extends Schema.TaggedError<TokenAlreadySpent>()(
  "TokenAlreadySpent",
  {
    mint: MintUrl,
  },
) {}

/** Transient failure talking to the mint; retrying later may succeed. */
export class MintUnreachable extends Schema.TaggedError<MintUnreachable>()(
  "MintUnreachable",
  {
    mint: MintUrl,
    detail: Schema.NullOr(Schema.String),
  },
) {}

/** Definitive protocol rejection by the mint (NUT error code when known). */
export class MintRejected extends Schema.TaggedError<MintRejected>()(
  "MintRejected",
  {
    mint: MintUrl,
    code: Schema.NullOr(Schema.Int),
    detail: Schema.String,
  },
) {}

export class InsufficientFunds extends Schema.TaggedError<InsufficientFunds>()(
  "InsufficientFunds",
  {
    mint: MintUrl,
    required: Amount,
    available: NonNegativeAmount,
  },
) {}

export class QuoteExpired extends Schema.TaggedError<QuoteExpired>()(
  "QuoteExpired",
  {
    quoteId: QuoteId,
    mint: MintUrl,
  },
) {}

/** The mint accepted the melt but the Lightning payment did not settle. */
export class PaymentFailed extends Schema.TaggedError<PaymentFailed>()(
  "PaymentFailed",
  {
    mint: MintUrl,
    quoteId: QuoteId,
    detail: Schema.NullOr(Schema.String),
  },
) {}

/**
 * The melt request was sent and the mint has not settled it either way: the
 * inputs stay `held` by the melt operation `operationId`, which
 * `Melt.resumePending` settles once the mint answers PAID or UNPAID.
 */
export class PaymentPending extends Schema.TaggedError<PaymentPending>()(
  "PaymentPending",
  {
    mint: MintUrl,
    quoteId: QuoteId,
    operationId: OperationId,
    amount: Amount,
  },
) {}

/**
 * The mint already issued this quote's proofs and no attempt of this wallet
 * reserved counter slots for it, so another wallet holds them; nothing to
 * mint or reclaim here.
 */
export class QuoteAlreadyIssued extends Schema.TaggedError<QuoteAlreadyIssued>()(
  "QuoteAlreadyIssued",
  {
    quoteId: QuoteId,
    mint: MintUrl,
  },
) {}

/**
 * The cross-context lease protecting this deterministic counter could not be
 * acquired in time; another tab/process holds it. Nothing was derived.
 */
export class CounterLockTimeout extends Schema.TaggedError<CounterLockTimeout>()(
  "CounterLockTimeout",
  {
    mint: MintUrl,
    unit: CurrencyUnit,
    keysetId: KeysetId,
  },
) {}

/** Unspent proofs still name the mint; it cannot be forgotten. */
export class MintInUse extends Schema.TaggedError<MintInUse>()("MintInUse", {
  mint: MintUrl,
  proofCount: Schema.Int.pipe(Schema.positive()),
}) {}

export class OperationNotFound extends Schema.TaggedError<OperationNotFound>()(
  "OperationNotFound",
  {
    operationId: OperationId,
  },
) {}
