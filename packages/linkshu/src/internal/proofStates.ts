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

const chunkProofs = <P>(
  proofs: ReadonlyArray<P>,
): ReadonlyArray<ReadonlyArray<P>> => {
  const chunks: Array<ReadonlyArray<P>> = [];
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
  proofs: ReadonlyArray<Pick<Proof, "secret" | "id">>,
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
