import { Schema } from "effect";
import { MintRejected, MintUnreachable } from "../domain/errors";
import { Amount, MintUrl, NonNegativeAmount } from "../domain/primitives";

export class FeeProbeDraft extends Schema.Class<FeeProbeDraft>("FeeProbeDraft")(
  {
    /** Mint whose Lightning fee is being probed. */
    mint: MintUrl,
    /** A different, Lightning-backed mint that issues the probe invoice. */
    probeMint: MintUrl,
    /** Defaults to a representative probe size (10 000 sat). */
    amount: Schema.optional(Amount),
  },
) {}

export class LightningFeeProbeResult extends Schema.Class<LightningFeeProbeResult>(
  "LightningFeeProbeResult",
)({
  mint: MintUrl,
  probeMint: MintUrl,
  amount: Amount,
  feeReserve: NonNegativeAmount,
  /** `feeReserve / amount`, as a percentage. */
  percent: Schema.Number,
}) {}

export const FeeProbeError = Schema.Union([MintUnreachable, MintRejected]);
export type FeeProbeError = typeof FeeProbeError.Type;
