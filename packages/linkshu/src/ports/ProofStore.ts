import { Context, Effect, Schema } from "effect";
import {
  Amount,
  CurrencyUnit,
  KeysetId,
  MintUrl,
  OperationId,
  ProofId,
  UnixSeconds,
} from "../domain/primitives";

/**
 * Where a stored proof stands in the wallet. Mint truth (`spent`) and wallet
 * availability share one column because they never overlap: a proof the
 * mint reports spent is dead whatever the wallet thought.
 *
 * - `available`    — spendable balance
 * - `held`         — inputs of an in-flight melt or an open envelope
 *                    (`operationId` names it); null `operationId` means the
 *                    holder has not synced yet, and the proof stays held
 * - `handedOut`    — encoded into a token someone else may claim
 *                    (`operationId` names the send)
 * - `externalized` — handed off outside the app entirely
 * - `spent`        — terminal; kept so re-ingest and restore dedup against it
 *                    and keysets stay bound to their mint
 */
export const ProofState = Schema.Literals([
  "available",
  "held",
  "handedOut",
  "externalized",
  "spent",
]);
export type ProofState = typeof ProofState.Type;

const proofFields = {
  mint: MintUrl,
  unit: CurrencyUnit,
  keysetId: KeysetId,
  amount: Amount,
  secret: Schema.NonEmptyString,
  /** Hex-encoded signature point; the NUT-00 `C` field. */
  C: Schema.String.check(Schema.isPattern(/^(?:[0-9a-f]{2})+$/i)),
  /** JSON of the NUT-12 DLEQ proof when the mint supplied one. */
  dleq: Schema.NullOr(Schema.String),
  state: ProofState,
  operationId: Schema.NullOr(OperationId),
};

/**
 * One persisted proof — the unit of the wallet inventory. The store is dumb
 * on purpose: every state decision is package logic, the store only
 * persists what it is given.
 */
export class StoredProof extends Schema.Class<StoredProof>("StoredProof")({
  id: ProofId,
  ...proofFields,
  createdAt: UnixSeconds,
}) {}

export class NewProof extends Schema.Class<NewProof>("NewProof")(proofFields) {}

export interface ProofPatch {
  readonly state?: ProofState;
  readonly operationId?: OperationId | null;
}

export interface ProofStoreService {
  /**
   * Persists the proofs and assigns ids and `createdAt`. The id MUST be a
   * pure function of `secret`, so two devices storing one proof converge on
   * one row; inserting a secret that is already stored is therefore an
   * upsert onto that row.
   */
  readonly insert: (
    proofs: ReadonlyArray<NewProof>,
  ) => Effect.Effect<ReadonlyArray<StoredProof>>;
  /** Applies the present fields; unknown id: no-op. */
  readonly update: (id: ProofId, patch: ProofPatch) => Effect.Effect<void>;
  /**
   * Every stored proof whose state is not `spent`: the working set the
   * package reads before every decision. It must not grow with the
   * wallet's history; the package holds no cache of its own.
   */
  readonly loadUnspent: Effect.Effect<ReadonlyArray<StoredProof>>;
  /** The stored proofs with these secrets, any state. */
  readonly findBySecrets: (
    secrets: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<StoredProof>>;
  /** The stored proofs whose `operationId` is this operation, any state. */
  readonly findByOperation: (
    operationId: OperationId,
  ) => Effect.Effect<ReadonlyArray<StoredProof>>;
  /**
   * Per keyset id, its oldest stored proof (lowest `createdAt`), any state;
   * a keyset with no stored proof is absent.
   */
  readonly findOldestByKeysets: (
    keysetIds: ReadonlyArray<KeysetId>,
  ) => Effect.Effect<ReadonlyArray<StoredProof>>;
}

export class ProofStore extends Context.Service<
  ProofStore,
  ProofStoreService
>()("linkshu/ProofStore") {}
