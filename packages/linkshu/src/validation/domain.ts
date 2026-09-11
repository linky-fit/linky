import { Schema } from "effect";
import { Amount, MintUrl, OperationId, ProofId } from "../domain/primitives";

export class SpentProofReport extends Schema.Class<SpentProofReport>(
  "SpentProofReport",
)({
  proofId: ProofId,
  amount: Amount,
}) {}

export class ValidationReport extends Schema.Class<ValidationReport>(
  "ValidationReport",
)({
  /** Proofs the mints actually answered about. */
  checkedProofs: Schema.Int,
  /** Proofs definitively spent, marked so individually. */
  markedSpent: Schema.Array(SpentProofReport),
  /** Held-by-unknown proofs the mint reported unspent, now `available`. */
  released: Schema.Int,
  /** Mints that could not be reached; their proofs were left untouched. */
  unavailableMints: Schema.Array(MintUrl),
}) {}

export class TransferCheckResult extends Schema.Class<TransferCheckResult>(
  "TransferCheckResult",
)({
  operationId: OperationId,
  /** `unavailable` = mint unreachable or unanswered; never treated as spent. */
  status: Schema.Literal("live", "spent", "unavailable"),
}) {}

export class ClaimedTransferReport extends Schema.Class<ClaimedTransferReport>(
  "ClaimedTransferReport",
)({
  operationId: OperationId,
  amount: Amount,
}) {}

export class IssuedClaimReport extends Schema.Class<IssuedClaimReport>(
  "IssuedClaimReport",
)({
  /** Handed-out transfers found fully spent — claimed by the recipient — now `done`. */
  claimed: Schema.Array(ClaimedTransferReport),
}) {}

/** One proof's current NUT-07 answer; no secret leaves the operation. */
export class ProofStateSnapshot extends Schema.Class<ProofStateSnapshot>(
  "ProofStateSnapshot",
)({
  proofId: ProofId,
  state: Schema.Literal("unspent", "pending", "spent", "unknown"),
}) {}
