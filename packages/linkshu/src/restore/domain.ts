import { Schema } from "effect";
import { KeysetId, MintUrl, NonNegativeAmount } from "../domain/primitives";

export class RestoreDraft extends Schema.Class<RestoreDraft>("RestoreDraft")({
  /** Defaults to every known mint (stored proofs, seen mints, defaults). */
  mints: Schema.optional(Schema.Array(MintUrl)),
}) {}

export class SkippedKeyset extends Schema.Class<SkippedKeyset>("SkippedKeyset")(
  {
    mint: MintUrl,
    keysetId: KeysetId,
    detail: Schema.String,
  },
) {}

export class RestoreReport extends Schema.Class<RestoreReport>("RestoreReport")(
  {
    restoredAmount: NonNegativeAmount,
    /** `available` proofs created from the scan. */
    restoredProofs: Schema.Int,
    scannedMints: Schema.Array(MintUrl),
    unavailableMints: Schema.Array(MintUrl),
    skippedKeysets: Schema.optionalWith(Schema.Array(SkippedKeyset), {
      default: () => [],
    }),
  },
) {}

export interface RestoreProgress {
  readonly phase: "preparing" | "scanning" | "refreshing";
  readonly completedKeysets: number;
  readonly totalKeysets: number;
  readonly totalMints: number;
}
