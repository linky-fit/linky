import { Schema } from "effect";
import { MintUrl } from "../domain/primitives";

export class MintInfo extends Schema.Class<MintInfo>("MintInfo")({
  url: MintUrl,
  name: Schema.NullOr(Schema.String),
  /**
   * Cashu-side input fee of the preferred active keyset, per thousand proof
   * inputs (NUT-02 `input_fee_ppk`); null when the mint publishes none.
   */
  inputFeePpk: Schema.NullOr(Schema.Int.pipe(Schema.nonNegative())),
  /** NUT-15 multi-path payments. */
  supportsMpp: Schema.Boolean,
  /** Known test URL or published metadata advertising simulated Lightning. */
  isFakeLightning: Schema.Boolean,
  iconUrl: Schema.NullOr(Schema.String),
}) {}
