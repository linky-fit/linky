import { Effect } from "effect";
import { NonNegativeAmount } from "../domain/primitives";
import { checkProofStates } from "../internal/proofStates";
import { groupRowsByMint } from "../internal/rowStates";
import type { WalletInstances } from "../mint/internal/WalletInstances";
import type { StoredTokenRow } from "../ports/TokenStore";
import { parseTokenText } from "../token/codec";
import { collectRowProofs } from "../token/internal/rowProofs";
import { TokenProofStateAmounts } from "./domain";

export const inspectStoredProofStates = (
  instances: WalletInstances,
  rows: ReadonlyArray<StoredTokenRow>,
): Effect.Effect<ReadonlyArray<TokenProofStateAmounts>> =>
  Effect.gen(function* () {
    const reports = new Map(
      rows.map((row) => [
        row.id,
        new TokenProofStateAmounts({
          rowId: row.id,
          unspent: NonNegativeAmount.make(0),
          pending: NonNegativeAmount.make(0),
          spent: NonNegativeAmount.make(0),
          unknown: NonNegativeAmount.make(
            parseTokenText(row.tokenText)?.amount ?? 0,
          ),
        }),
      ]),
    );
    yield* Effect.forEach(
      groupRowsByMint(rows),
      (group) =>
        Effect.gen(function* () {
          const wallet = yield* instances.get(group.mint, group.unit);
          const entries = collectRowProofs(
            group.rows,
            group.mint,
            group.unit,
            wallet.keyChain.getKeysets().map((keyset) => keyset.id),
          );
          const states = yield* checkProofStates(
            wallet,
            group.mint,
            entries.flatMap((entry) => entry.proofs),
          );
          let offset = 0;
          for (const entry of entries) {
            let unspent = 0;
            let pending = 0;
            let spent = 0;
            let unknown = 0;
            for (const proof of entry.proofs) {
              const state = states[offset++]?.state.trim().toUpperCase();
              if (state === "UNSPENT") unspent += proof.amount;
              else if (state === "PENDING") pending += proof.amount;
              else if (state === "SPENT") spent += proof.amount;
              else unknown += proof.amount;
            }
            reports.set(
              entry.row.id,
              new TokenProofStateAmounts({
                rowId: entry.row.id,
                unspent: NonNegativeAmount.make(unspent),
                pending: NonNegativeAmount.make(pending),
                spent: NonNegativeAmount.make(spent),
                unknown: NonNegativeAmount.make(unknown),
              }),
            );
          }
        }).pipe(Effect.catchAll(() => Effect.void)),
      { concurrency: 4, discard: true },
    );
    return [...reports.values()];
  });
