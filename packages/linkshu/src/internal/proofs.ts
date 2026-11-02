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

/** The secrets of `proofs` the store already holds, in any state. */
export const knownSecretsOf = (
  proofStore: ProofStoreService,
  proofs: ReadonlyArray<{ readonly secret: string }>,
): Effect.Effect<Set<string>> =>
  Effect.map(
    proofStore.findBySecrets(proofs.map((proof) => proof.secret)),
    storedSecrets,
  );

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
        { disableChecks: true },
      ),
  );
};

/** Fresh proofs to store, reported under `reason`. */
export interface ProofInsert {
  readonly proofs: ReadonlyArray<NewProof>;
  readonly reason: string;
}

/**
 * Stored proofs to move to `state`, optionally re-pointed at an operation
 * (`operationId` undefined keeps each proof's link).
 */
export interface ProofMove {
  readonly proofs: ReadonlyArray<StoredProof>;
  readonly state: ProofState;
  readonly reason: string;
  readonly operationId?: OperationId | null | undefined;
}

const emitMoved = (
  inspector: InspectorService,
  { proofs, state, reason, operationId }: ProofMove,
): void => {
  const byFrom = new Map<ProofState, StoredProof[]>();
  for (const proof of proofs) {
    const group = byFrom.get(proof.state) ?? [];
    group.push(proof);
    byFrom.set(proof.state, group);
  }
  for (const [from, group] of byFrom) {
    emitChanged(
      inspector,
      group,
      from,
      state,
      operationId === undefined ? (group[0]?.operationId ?? null) : operationId,
      reason,
    );
  }
};

/**
 * Books the inserts and moves in one store write, so they land together or
 * not at all. One event per insert and per state a move's proofs came from.
 * Returns each insert's stored proofs.
 */
export const bookProofs = (
  ctx: ProofContext,
  inserts: ReadonlyArray<ProofInsert>,
  moves: ReadonlyArray<ProofMove> = [],
): Effect.Effect<ReadonlyArray<ReadonlyArray<StoredProof>>> =>
  Effect.gen(function* () {
    const insert = inserts.flatMap(({ proofs }) => proofs);
    const update = moves.flatMap(({ proofs, state, operationId }) => {
      const patch =
        operationId === undefined ? { state } : { state, operationId };
      return proofs.map((proof) => ({ id: proof.id, patch }));
    });
    if (insert.length === 0 && update.length === 0)
      return inserts.map(() => []);
    const stored = yield* ctx.proofStore.write({ insert, update });
    let offset = 0;
    const booked = inserts.map(({ proofs, reason }) => {
      const group = stored.slice(offset, offset + proofs.length);
      offset += proofs.length;
      const first = group[0];
      if (first !== undefined)
        emitChanged(
          ctx.inspector,
          group,
          null,
          first.state,
          first.operationId,
          reason,
        );
      return group;
    });
    for (const move of moves) emitMoved(ctx.inspector, move);
    return booked;
  });

/** Persists fresh proofs and reports the batch. */
export const insertProofs = (
  ctx: ProofContext,
  proofs: ReadonlyArray<NewProof>,
  reason: string,
): Effect.Effect<ReadonlyArray<StoredProof>> =>
  Effect.map(bookProofs(ctx, [{ proofs, reason }]), ([stored]) => stored ?? []);

/** Moves proofs to `state` in one write; see `ProofMove`. */
export const setProofState = (
  ctx: ProofContext,
  proofs: ReadonlyArray<StoredProof>,
  state: ProofState,
  reason: string,
  operationId?: OperationId | null,
): Effect.Effect<void> =>
  Effect.asVoid(bookProofs(ctx, [], [{ proofs, state, reason, operationId }]));

export const amountOf = (proofs: ReadonlyArray<StoredProof>): Amount =>
  Amount.make(totalAmount(proofs));
