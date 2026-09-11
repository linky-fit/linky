import { Schema } from "effect";
import {
  Amount,
  CurrencyUnit,
  DeterministicCounter,
  KeysetId,
  MintUrl,
  NonNegativeAmount,
  OperationId,
  QuoteId,
} from "../domain/primitives";
import { OperationKind, OperationStatus } from "../ports/OperationStore";
import { ProofState } from "../ports/ProofStore";

/**
 * Diagnostic taps over everything linkshu does, emitted only when the
 * optional `Inspector` service is provided. `Schema.Unknown` fields carry
 * raw values for display; nothing in the package reads them back, and no
 * event ever carries seed material or proof secrets.
 */

/** A wallet operation finished, e.g. `name: "receive.receive"`. */
export class OperationSucceeded extends Schema.TaggedClass<OperationSucceeded>()(
  "OperationSucceeded",
  {
    name: Schema.String,
    params: Schema.Unknown,
    result: Schema.Unknown,
  },
) {}

export class OperationFailed extends Schema.TaggedClass<OperationFailed>()(
  "OperationFailed",
  {
    name: Schema.String,
    params: Schema.Unknown,
    error: Schema.Unknown,
  },
) {}

/**
 * A batch of stored proofs changed state; `from` is null for fresh proofs.
 * Amounts and counts only — the proofs themselves never travel.
 */
export class ProofsChanged extends Schema.TaggedClass<ProofsChanged>()(
  "ProofsChanged",
  {
    mint: MintUrl,
    count: Schema.Int,
    amount: NonNegativeAmount,
    from: Schema.NullOr(ProofState),
    to: ProofState,
    operationId: Schema.NullOr(OperationId),
    reason: Schema.String,
  },
) {}

/** A stored operation changed status; `from` is null for fresh operations. */
export class OperationChanged extends Schema.TaggedClass<OperationChanged>()(
  "OperationChanged",
  {
    operationId: OperationId,
    kind: OperationKind,
    from: Schema.NullOr(OperationStatus),
    to: OperationStatus,
    reason: Schema.String,
  },
) {}

/** A deterministic counter moved — the audit trail for collision recovery. */
export class CounterAdvanced extends Schema.TaggedClass<CounterAdvanced>()(
  "CounterAdvanced",
  {
    mint: MintUrl,
    unit: CurrencyUnit,
    keysetId: KeysetId,
    from: DeterministicCounter,
    to: DeterministicCounter,
    reason: Schema.Literal("used", "collision-recovery", "restore"),
  },
) {}

/** A mint/melt quote was observed in a new state while a flow watched it. */
export class QuoteStateChanged extends Schema.TaggedClass<QuoteStateChanged>()(
  "QuoteStateChanged",
  {
    flow: Schema.Literal("topup", "autoswap", "melt"),
    quoteId: QuoteId,
    mint: MintUrl,
    state: Schema.String,
    /** Which watcher saw it; absent in rows written before NUT-17. */
    via: Schema.optional(Schema.Literal("poll", "subscription")),
  },
) {}

/**
 * A mint's Lightning fee was measured. Both quote ids travel so a consumer
 * can correlate the row with the mint's own quote traffic on either side.
 */
export class LightningFeeProbed extends Schema.TaggedClass<LightningFeeProbed>()(
  "LightningFeeProbed",
  {
    mint: MintUrl,
    probeMint: MintUrl,
    /** Melt quote at `mint` — the priced side. */
    meltQuoteId: QuoteId,
    /** Mint quote at `probeMint` whose (unpaid) invoice was priced. */
    mintQuoteId: QuoteId,
    amount: Amount,
    feeReserve: NonNegativeAmount,
    percent: Schema.Number,
  },
) {}

export const LinkshuInspectorEvent = Schema.Union(
  OperationSucceeded,
  OperationFailed,
  ProofsChanged,
  OperationChanged,
  CounterAdvanced,
  QuoteStateChanged,
  LightningFeeProbed,
);
export type LinkshuInspectorEvent = typeof LinkshuInspectorEvent.Type;
