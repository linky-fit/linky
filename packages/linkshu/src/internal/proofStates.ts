import { Effect } from "effect";
import type { MintRejected, MintUnreachable } from "../domain/errors";
import type { MintUrl } from "../domain/primitives";
import { classifyMintError } from "../mint/internal/WalletInstances";
import type { LoadedWallet } from "../mint/internal/WalletInstances";
import type { Proof } from "../token/domain";

/**
 * Shared NUT-07 machinery: one batched checkstate call per mint, and the
 * three ways the package reads its answer.
 *
 * The mint answers per proof, in the order the proofs were sent; cashu-ts
 * chunks the request internally and re-emits the states aligned to the input.
 * A missing, truncated, or unrecognized answer is *no information* — never a
 * guess — but which way "no information" falls depends on what the caller is
 * about to do:
 *
 * - Spending offers only confirmed unspent proofs; unresolved inputs remain
 *   stored for a later check.
 * - `unspentProofs` (restore) keeps only proofs explicitly reported unspent,
 *   so an unanswered proof is never imported as balance.
 * - `partitionGroupsByState` (validation) marks a row spent only when every
 *   one of its proofs came back spent, so an unanswered proof protects it.
 */

/** The one field of a NUT-07 answer the package reads. */
export interface ProofStateEntry {
  readonly state: string;
}

const SPENT = "SPENT";
const UNSPENT = "UNSPENT";

const stateAt = (
  states: ReadonlyArray<ProofStateEntry>,
  index: number,
): string | null => {
  const entry = states[index];
  return entry === undefined ? null : entry.state.trim().toUpperCase();
};

/**
 * States of `proofs` at `mint`, aligned to the input order. Empty input never
 * reaches the mint; a non-array answer reads as no answer at all.
 */
export const checkProofStates = (
  wallet: LoadedWallet,
  mint: MintUrl,
  proofs: ReadonlyArray<Proof>,
): Effect.Effect<
  ReadonlyArray<ProofStateEntry>,
  MintUnreachable | MintRejected
> =>
  proofs.length === 0
    ? Effect.succeed([])
    : Effect.tryPromise({
        try: () =>
          wallet.checkProofsStates(
            proofs.map((proof) => ({ secret: proof.secret, id: proof.id })),
          ),
        catch: (error) => classifyMintError(mint, error),
      }).pipe(Effect.map((states) => (Array.isArray(states) ? states : [])));

/** Secrets the mint explicitly reported spent. */
export const spentSecrets = (
  proofs: ReadonlyArray<Proof>,
  states: ReadonlyArray<ProofStateEntry>,
): ReadonlySet<string> =>
  new Set(
    proofs
      .filter((_, index) => stateAt(states, index) === SPENT)
      .map((proof) => proof.secret),
  );

/** Proofs the mint explicitly reported unspent. */
export const unspentProofs = (
  proofs: ReadonlyArray<Proof>,
  states: ReadonlyArray<ProofStateEntry>,
): ReadonlyArray<Proof> =>
  proofs.filter((_, index) => stateAt(states, index) === UNSPENT);

export interface ProofGroup {
  readonly proofs: ReadonlyArray<Proof>;
}

export interface LiveGroup<G> {
  readonly group: G;
  /** Only the proofs that came back unspent; the rest are gone at the mint. */
  readonly unspent: ReadonlyArray<Proof>;
}

export interface StatePartition<G> {
  readonly live: ReadonlyArray<LiveGroup<G>>;
  /** Every proof spent and none unanswered — definitively dead. */
  readonly fullySpent: ReadonlyArray<G>;
  /** Truncated, pending, or unrecognized answers; nothing may be concluded. */
  readonly unknown: ReadonlyArray<G>;
}

/**
 * Splits groups that shared one checkstate call: `states` align to
 * `groups.flatMap((group) => group.proofs)`. A group surviving with at least
 * one unspent proof is live (carrying only those proofs), so one dead group
 * never poisons the rows next to it.
 */
export const partitionGroupsByState = <G extends ProofGroup>(
  groups: ReadonlyArray<G>,
  states: ReadonlyArray<ProofStateEntry>,
): StatePartition<G> => {
  const live: Array<LiveGroup<G>> = [];
  const fullySpent: G[] = [];
  const unknown: G[] = [];
  let offset = 0;
  for (const group of groups) {
    const groupStates = states.slice(offset, offset + group.proofs.length);
    offset += group.proofs.length;
    if (
      groupStates.length < group.proofs.length ||
      groupStates.some((_, index) => {
        const state = stateAt(groupStates, index);
        return state !== SPENT && state !== UNSPENT;
      })
    ) {
      unknown.push(group);
      continue;
    }
    const unspent = unspentProofs(group.proofs, groupStates);
    if (unspent.length > 0) {
      live.push({ group, unspent });
      continue;
    }
    const allSpent = group.proofs.every(
      (_, index) => stateAt(groupStates, index) === SPENT,
    );
    if (allSpent) fullySpent.push(group);
    else unknown.push(group);
  }
  return { live, fullySpent, unknown };
};

/** One check candidate per distinct secret (rows may share proofs). */
export const dedupeProofs = (
  proofs: ReadonlyArray<Proof>,
): ReadonlyArray<Proof> => {
  const seen = new Set<string>();
  return proofs.filter((proof) => {
    if (seen.has(proof.secret)) return false;
    seen.add(proof.secret);
    return true;
  });
};
