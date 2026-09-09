import { Schema } from "effect";
import {
  Amount,
  MintUrl,
  NonNegativeAmount,
  TokenRowId,
} from "../domain/primitives";

export class SpentTokenReport extends Schema.Class<SpentTokenReport>(
  "SpentTokenReport",
)({
  rowId: TokenRowId,
  amount: Amount,
}) {}

export class ValidationReport extends Schema.Class<ValidationReport>(
  "ValidationReport",
)({
  checkedRows: Schema.Int,
  /** Rows definitively spent, marked `error` individually. */
  markedSpent: Schema.Array(SpentTokenReport),
  /** Sibling rows merged into a per-mint primary and removed. */
  mergedRows: Schema.Array(TokenRowId),
  /** Mints that could not be reached; their rows were left untouched. */
  unavailableMints: Schema.Array(MintUrl),
}) {}

export class RowCheckResult extends Schema.Class<RowCheckResult>(
  "RowCheckResult",
)({
  rowId: TokenRowId,
  /** `unavailable` = mint unreachable; never treated as spent. */
  status: Schema.Literal("live", "spent", "unavailable"),
}) {}

export class IssuedClaimReport extends Schema.Class<IssuedClaimReport>(
  "IssuedClaimReport",
)({
  /** Issued rows found fully spent — i.e. claimed by the recipient — and removed. */
  claimed: Schema.Array(SpentTokenReport),
}) {}

/** Read-only NUT-07 amounts; no proofs or secrets leave the operation. */
export class TokenProofStateAmounts extends Schema.Class<TokenProofStateAmounts>(
  "TokenProofStateAmounts",
)({
  rowId: TokenRowId,
  unspent: NonNegativeAmount,
  pending: NonNegativeAmount,
  spent: NonNegativeAmount,
  unknown: NonNegativeAmount,
}) {}
