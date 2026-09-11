import { Schema } from "effect";
import { MintUrl, NonNegativeAmount } from "../domain/primitives";

export class RestoreDraft extends Schema.Class<RestoreDraft>("RestoreDraft")({
  /** Defaults to every known mint (stored proofs, seen mints, defaults). */
  mints: Schema.optional(Schema.Array(MintUrl)),
}) {}

export class RestoreReport extends Schema.Class<RestoreReport>("RestoreReport")(
  {
    restoredAmount: NonNegativeAmount,
    /** `available` proofs created from the scan. */
    restoredProofs: Schema.Int,
    scannedMints: Schema.Array(MintUrl),
    unavailableMints: Schema.Array(MintUrl),
  },
) {}
