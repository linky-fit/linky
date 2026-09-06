import { Effect } from "effect";
import { CurrencyUnit } from "../domain/primitives";
import type { MintUrl } from "../domain/primitives";
import type { WalletInstances } from "../mint/internal/WalletInstances";
import type { StoredTokenRow } from "../ports/TokenStore";
import { parseTokenText } from "../token/codec";
import { collectRowProofs } from "../token/internal/rowProofs";
import type { RowProofs } from "../token/internal/rowProofs";
import { checkProofStates, partitionGroupsByState } from "./proofStates";
import type { StatePartition } from "./proofStates";
import { sat } from "./units";

/**
 * Asking mints about stored rows: the grouping that decides who to ask, and
 * the batched NUT-07 call itself. Shared by validation and by
 * `Tokens.deleteSpent`, which sweeps before it deletes.
 */

/** Rows that share a mint and unit, and therefore one checkstate call. */
export interface MintRowGroup {
  readonly mint: MintUrl;
  readonly unit: CurrencyUnit;
  readonly rows: ReadonlyArray<StoredTokenRow>;
}

/**
 * Buckets rows by the mint and unit their token text states. Grouping reads
 * metadata only — no keysets, so no wallet has to be loaded to decide which
 * mint to ask. Rows stating no mint are dropped: nobody can be asked about
 * them.
 */
export const groupRowsByMint = (
  rows: ReadonlyArray<StoredTokenRow>,
): ReadonlyArray<MintRowGroup> => {
  const groups = new Map<
    string,
    { mint: MintUrl; unit: CurrencyUnit; rows: StoredTokenRow[] }
  >();
  for (const row of rows) {
    const parsed = parseTokenText(row.tokenText);
    if (parsed === null || parsed.mint === null) continue;
    const unit = parsed.unit ?? sat;
    const key = `${parsed.mint}|${unit}`;
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, { mint: parsed.mint, unit, rows: [row] });
      continue;
    }
    existing.rows.push(row);
  }
  return [...groups.values()];
};

/**
 * One mint, one checkstate call. `null` means the mint gave no usable answer
 * (unreachable, or it rejected the query) — that is information we do not
 * have, never information that rows are spent.
 */
export const checkMintRows = (
  instances: WalletInstances,
  mint: MintUrl,
  unit: CurrencyUnit,
  rows: ReadonlyArray<StoredTokenRow>,
): Effect.Effect<StatePartition<RowProofs> | null> =>
  Effect.gen(function* () {
    const wallet = yield* instances.get(mint, unit);
    const entries = collectRowProofs(
      rows,
      mint,
      unit,
      wallet.keyChain.getKeysets().map((keyset) => keyset.id),
    );
    if (entries.length === 0) return null;
    const states = yield* checkProofStates(
      wallet,
      mint,
      entries.flatMap((entry) => entry.proofs),
    );
    return partitionGroupsByState(entries, states);
  }).pipe(Effect.catchAll(() => Effect.succeed(null)));
