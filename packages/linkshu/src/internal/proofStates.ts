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
 * The mint answers per proof, in the order the proofs were sent; large sets
 * are split into 100-proof chunks and queried concurrently (bounded to 6 in
 * flight), padding short or malformed chunks with empty states so later chunks
 * never shift onto earlier proofs. A missing, truncated, or unrecognized answer
 * is *no information* — never a guess — but which way "no information" falls
 * depends on what the caller is about to do:
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
/** Matches cashu-ts's internal NUT-07 batch size so each chunk is one request. */
const CHECK_STATE_CHUNK_SIZE = 100;
/** Covers <=600 proofs in one wave without unbounded bursts against a mint. */
const CHECK_STATE_CONCURRENCY = 6;
const UNKNOWN_STATE: ProofStateEntry = { state: "" };

const stateAt = (
  states: ReadonlyArray<ProofStateEntry>,
  index: number,
): string | null => {
  const entry = states[index];
  return entry === undefined ? null : entry.state.trim().toUpperCase();
};

const chunkProofs = (
  proofs: ReadonlyArray<Proof>,
): ReadonlyArray<ReadonlyArray<Proof>> => {
  const chunks: Array<ReadonlyArray<Proof>> = [];
  for (let i = 0; i < proofs.length; i += CHECK_STATE_CHUNK_SIZE) {
    chunks.push(proofs.slice(i, i + CHECK_STATE_CHUNK_SIZE));
  }
  return chunks;
};

const toStateEntry = (entry: unknown): ProofStateEntry => {
  if (typeof entry !== "object" || entry === null) return UNKNOWN_STATE;
  const state: unknown = Reflect.get(entry, "state");
  return typeof state === "string" ? { state } : UNKNOWN_STATE;
};

const alignChunkStates = (
  raw: unknown,
  expectedLength: number,
): ReadonlyArray<ProofStateEntry> =>
  Array.isArray(raw)
    ? Array.from({ length: expectedLength }, (_, index) =>
        toStateEntry(raw[index]),
      )
    : Array.from({ length: expectedLength }, () => UNKNOWN_STATE);

/**
 * States of `proofs` at `mint`, aligned to the input order. Empty input never
 * reaches the mint; short, overlong, or non-array chunk answers are aligned to
 * their chunk length with unknown entries so indices never shift across chunks.
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
    : Effect.forEach(
        chunkProofs(proofs),
        (chunk) =>
          Effect.tryPromise({
            try: () =>
              wallet.checkProofsStates(
                chunk.map((proof) => ({ secret: proof.secret, id: proof.id })),
              ),
            catch: (error) => classifyMintError(mint, error),
          }).pipe(
            Effect.map((states) => alignChunkStates(states, chunk.length)),
          ),
        { concurrency: CHECK_STATE_CONCURRENCY },
      ).pipe(Effect.map((chunks) => chunks.flat()));

export type ProofAnswer = "unspent" | "pending" | "spent" | "unknown";

/** The mint's answer for the proof at `index`. */
export const answerAt = (
  states: ReadonlyArray<ProofStateEntry>,
  index: number,
): ProofAnswer => {
  const raw = stateAt(states, index);
  if (raw === UNSPENT) return "unspent";
  if (raw === "PENDING") return "pending";
  if (raw === SPENT) return "spent";
  return "unknown";
};

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
