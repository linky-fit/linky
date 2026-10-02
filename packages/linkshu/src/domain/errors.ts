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

/**
 * A fresh receive could not reach the token's mint before recording anything:
 * the text is kept under the `deferredReceive` operation `operationId`, which
 * `Receive.resumeDeferred` receives once the mint answers. Deferred, not
 * failed.
 */
export class ReceiveDeferred extends Schema.TaggedError<ReceiveDeferred>()(
  "ReceiveDeferred",
  {
    mint: MintUrl,
    operationId: OperationId,
    amount: Amount,
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

/**
 * The cashu input fee (NUT-02) the mint charges to swap the proofs is at
 * least their value, so a swap would leave nothing to sign. Receive and send
 * fail before the swap or any inventory changes; whoever redeems a sent
 * token pays that fee. Loading the wallet may fetch mint metadata first.
 */
export class AmountConsumedByFee extends Schema.TaggedError<AmountConsumedByFee>()(
  "AmountConsumedByFee",
  {
    mint: MintUrl,
    amount: Amount,
    /** What the swap costs; the amount has to exceed it. */
    fee: Amount,
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
 * A cross-context lease could not be acquired in time; another tab/process
 * holds it. `keysetId` names the deterministic counter the lease protects,
 * or is null for the lease over the mint's receives.
 */
export class CounterLockTimeout extends Schema.TaggedError<CounterLockTimeout>()(
  "CounterLockTimeout",
  {
    mint: MintUrl,
    unit: CurrencyUnit,
    keysetId: Schema.NullOr(KeysetId),
  },
) {}

/**
 * Unspent proofs or pending deferred receives still name the mint; it cannot
 * be forgotten. At least one of the counts is positive.
 */
export class MintInUse extends Schema.TaggedError<MintInUse>()("MintInUse", {
  mint: MintUrl,
  proofCount: Schema.Int.pipe(Schema.nonNegative()),
  deferredReceiveCount: Schema.Int.pipe(Schema.nonNegative()),
}) {}

export class OperationNotFound extends Schema.TaggedError<OperationNotFound>()(
  "OperationNotFound",
  {
    operationId: OperationId,
  },
) {}
