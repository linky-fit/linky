import type { Proof as CashuProof } from "@cashu/cashu-ts";
import { Effect } from "effect";
import {
  Amount,
  CurrencyUnit,
  MintUrl,
  UnixSeconds,
} from "../domain/primitives";
import type { OperationId, TokenText } from "../domain/primitives";
import { toNewProofs } from "../internal/proofs";
import { NewOperation, OperationStore } from "../ports/OperationStore";
import type { OperationStatus, StoredOperation } from "../ports/OperationStore";
import { ProofStore } from "../ports/ProofStore";
import type { ProofState, StoredProof } from "../ports/ProofStore";

const sat = CurrencyUnit.make("sat");

/** Stores cashu-ts proofs at `mint` in `state`; the inventory analogue of seeding a row. */
export const seedProofs = (
  mint: string,
  proofs: ReadonlyArray<CashuProof>,
  state: ProofState = "available",
  operationId: OperationId | null = null,
) =>
  Effect.flatMap(ProofStore, (store) => {
    const rows = toNewProofs(
      proofs,
      MintUrl.make(mint),
      sat,
      state,
      operationId,
    );
    if (rows === null) return Effect.die(new Error("malformed seed proofs"));
    return store.insert(rows);
  });

/** Stores a `send` or `receive` transfer carrying `tokenText`. */
export const seedTransfer = (
  kind: "send" | "receive",
  status: OperationStatus,
  mint: string,
  tokenText: TokenText,
  amount: number,
  error: string | null = null,
): Effect.Effect<StoredOperation, never, OperationStore> =>
  Effect.flatMap(OperationStore, (store) =>
    store.insert(
      new NewOperation(
        {
          kind,
          status,
          mint: MintUrl.make(mint),
          unit: sat,
          keysetId: null,
          amount: Amount.make(amount),
          feeReserve: null,
          inputsTotal: null,
          quoteId: null,
          invoice: null,
          sourceMint: null,
          counter: null,
          locked: null,
          expiresAt: null,
          createdAt: UnixSeconds.make(1_700_000_000),
          tokenText,
          error,
        },
        { disableValidation: true },
      ),
    ),
  );

export const proofsIn = (
  proofs: ReadonlyArray<StoredProof>,
  state: ProofState,
): ReadonlyArray<StoredProof> =>
  proofs.filter((proof) => proof.state === state);

/** Secrets of the given proofs, sorted for stable assertions. */
export const secretsOf = (
  proofs: ReadonlyArray<{ readonly secret: string }>,
): ReadonlyArray<string> => proofs.map((proof) => proof.secret).sort();

export const amountIn = (
  proofs: ReadonlyArray<StoredProof>,
  state: ProofState,
): number =>
  proofsIn(proofs, state).reduce((sum, proof) => sum + proof.amount, 0);
