import type { Proof as CashuProof } from "@cashu/cashu-ts";
import { Effect, Schema } from "effect";
import { Amount, NonNegativeAmount } from "../domain/primitives";
import type { CurrencyUnit, MintUrl, OperationId } from "../domain/primitives";
import { ProofsChanged } from "../inspector/events";
import type { InspectorService } from "../inspector/Inspector";
import { NewProof } from "../ports/ProofStore";
import type {
  ProofState,
  ProofStoreService,
  StoredProof,
} from "../ports/ProofStore";
import { Proof } from "../token/domain";

/**
 * The inventory primitives every vertical shares: turning mint answers into
 * proof rows, moving rows between states with one inspector event per
 * batch, and the two lookups (by mint, by secret) spending and dedup need.
 */

export const totalAmount = (
  proofs: ReadonlyArray<{ readonly amount: number }>,
): number => proofs.reduce((sum, proof) => sum + proof.amount, 0);

const decodeProof = Schema.decodeUnknownOption(Proof);

const plainProof = (proof: CashuProof): unknown => ({
  id: proof.id,
  amount: proof.amount.toNumber(),
  secret: proof.secret,
  C: proof.C,
});

/**
 * cashu-ts proofs as fresh inventory rows; `null` when any of them is
 * malformed — a partial set would silently drop funds.
 */
export const toNewProofs = (
  proofs: ReadonlyArray<CashuProof>,
  mint: MintUrl,
  unit: CurrencyUnit,
  state: ProofState,
  operationId: OperationId | null,
): ReadonlyArray<NewProof> | null => {
  const rows: NewProof[] = [];
  for (const proof of proofs) {
    const decoded = decodeProof(plainProof(proof));
    if (decoded._tag === "None") return null;
    rows.push(
      new NewProof({
        mint,
        unit,
        keysetId: decoded.value.id,
        amount: decoded.value.amount,
        secret: decoded.value.secret,
        C: decoded.value.C,
        dleq: proof.dleq === undefined ? null : JSON.stringify(proof.dleq),
        state,
        operationId,
      }),
    );
  }
  return rows;
};

/** The same for proofs already in the package's own shape. */
export const domainToNewProofs = (
  proofs: ReadonlyArray<Proof>,
  mint: MintUrl,
  unit: CurrencyUnit,
  state: ProofState,
  operationId: OperationId | null,
): ReadonlyArray<NewProof> =>
  proofs.map(
    (proof) =>
      new NewProof({
        mint,
        unit,
        keysetId: proof.id,
        amount: proof.amount,
        secret: proof.secret,
        C: proof.C,
        dleq: null,
        state,
        operationId,
      }),
  );

/** A stored row as the NUT-00 proof mint calls and the token codec take. */
export const toDomainProof = (proof: StoredProof): Proof =>
  new Proof({
    id: proof.keysetId,
    amount: proof.amount,
    secret: proof.secret,
    C: proof.C,
  });

export const proofsAt = (
  proofs: ReadonlyArray<StoredProof>,
  mint: MintUrl,
  unit: CurrencyUnit,
): ReadonlyArray<StoredProof> =>
  proofs.filter((proof) => proof.mint === mint && proof.unit === unit);

export const storedSecrets = (
  proofs: ReadonlyArray<StoredProof>,
): Set<string> => new Set(proofs.map((proof) => proof.secret));

export interface ProofContext {
  readonly proofStore: ProofStoreService;
  readonly inspector: InspectorService;
}

const emitChanged = (
  inspector: InspectorService,
  proofs: ReadonlyArray<NewProof | StoredProof>,
  from: ProofState | null,
  to: ProofState,
  operationId: OperationId | null,
  reason: string,
): void => {
  const first = proofs[0];
  if (first === undefined) return;
  inspector.emit(
    () =>
      new ProofsChanged(
        {
          mint: first.mint,
          count: proofs.length,
          amount: NonNegativeAmount.make(totalAmount(proofs)),
          from,
          to,
          operationId,
          reason,
        },
        { disableValidation: true },
      ),
  );
};

/** Persists fresh proofs and reports the batch. */
export const insertProofs = (
  ctx: ProofContext,
  proofs: ReadonlyArray<NewProof>,
  reason: string,
): Effect.Effect<ReadonlyArray<StoredProof>> =>
  proofs.length === 0
    ? Effect.succeed([])
    : Effect.tap(ctx.proofStore.insert(proofs), (stored) =>
        Effect.sync(() => {
          const first = stored[0];
          if (first !== undefined)
            emitChanged(
              ctx.inspector,
              stored,
              null,
              first.state,
              first.operationId,
              reason,
            );
        }),
      );

/**
 * Moves proofs to `state`, optionally re-pointing them at an operation
 * (`operationId` undefined keeps the current link). One event per batch,
 * grouped by the state the proofs came from.
 */
export const setProofState = (
  ctx: ProofContext,
  proofs: ReadonlyArray<StoredProof>,
  state: ProofState,
  reason: string,
  operationId?: OperationId | null,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const patch =
      operationId === undefined ? { state } : { state, operationId };
    yield* Effect.forEach(
      proofs,
      (proof) => ctx.proofStore.update(proof.id, patch),
      { discard: true },
    );
    const byFrom = new Map<ProofState, StoredProof[]>();
    for (const proof of proofs) {
      const group = byFrom.get(proof.state) ?? [];
      group.push(proof);
      byFrom.set(proof.state, group);
    }
    for (const [from, group] of byFrom) {
      emitChanged(
        ctx.inspector,
        group,
        from,
        state,
        operationId === undefined
          ? (group[0]?.operationId ?? null)
          : operationId,
        reason,
      );
    }
  });

export const amountOf = (proofs: ReadonlyArray<StoredProof>): Amount =>
  Amount.make(totalAmount(proofs));
