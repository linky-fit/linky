import { Effect, Schema } from "effect";
import { inspectStoredProofStates } from "./inspectProofStates";
import { TokenAlreadySpent, TokenRowNotFound } from "../domain/errors";
import { Amount } from "../domain/primitives";
import type { CurrencyUnit, MintUrl, TokenRowId } from "../domain/primitives";
import { Inspector } from "../inspector/Inspector";
import { inspectOperation } from "../internal/operations";
import { dedupeProofs } from "../internal/proofStates";
import type { LiveGroup } from "../internal/proofStates";
import { checkMintRows, groupRowsByMint } from "../internal/rowStates";
import { WalletInstances } from "../mint/internal/WalletInstances";
import { TokenStore } from "../ports/TokenStore";
import type { StoredTokenRow } from "../ports/TokenStore";
import { encodeProofs } from "../token/internal/cashuProofs";
import {
  isLegalTransition,
  rewriteRowTokenText,
  transitionRow,
} from "../token/internal/lifecycle";
import { totalProofAmount } from "../token/internal/rowProofs";
import type { RowProofs } from "../token/internal/rowProofs";
import {
  IssuedClaimReport,
  RowCheckResult,
  SpentTokenReport,
  ValidationReport,
} from "./domain";

/** Serialized onto rows NUT-07 reports fully spent. */
const encodeSpentRowError = Schema.encodeSync(
  Schema.parseJson(TokenAlreadySpent),
);

const spentReport = (entry: RowProofs): SpentTokenReport =>
  new SpentTokenReport({
    rowId: entry.row.id,
    amount: Amount.make(totalProofAmount(entry.proofs)),
  });

/**
 * NUT-07 proof-state validation of stored rows. One batched checkstate call
 * per mint+unit group; per row, any unspent proof keeps it live (with only
 * the unspent proofs), all-spent marks it `error` individually, and an
 * unknown or truncated response never marks anything. Surviving proofs of a
 * group are merged locally into one re-encoded `accepted` row — validation
 * performs no swap, so it costs no mint signatures. Mint unavailability is
 * data in the reports, never a failure of the operation.
 */
export class Validation extends Effect.Service<Validation>()(
  "linkshu/Validation",
  {
    dependencies: [WalletInstances.Default],
    effect: Effect.gen(function* () {
      const tokenStore = yield* TokenStore;
      const instances = yield* WalletInstances;
      const inspector = yield* Inspector.orNoop;

      /**
       * Definitive spend knowledge, persisted where the state machine allows
       * it: `externalized` rows left the app and dead `error` rows are
       * already marked, so both keep their state and are only reported.
       */
      const markRowSpent = (
        row: StoredTokenRow,
        mint: MintUrl,
      ): Effect.Effect<void> =>
        isLegalTransition(row.state, "error")
          ? Effect.orDie(
              transitionRow(tokenStore, inspector, row, "error", "validation", {
                error: encodeSpentRowError(new TokenAlreadySpent({ mint })),
              }),
            )
          : Effect.void;

      /**
       * Collapses a mint's surviving proofs into the first live row and drops
       * the rest. Purely local re-encoding: the primary carries the merged
       * proofs before any sibling is removed, so nothing is ever outside the
       * store. Returns the removed row ids.
       */
      const mergeLiveRows = (
        live: ReadonlyArray<LiveGroup<RowProofs>>,
        mint: MintUrl,
        unit: CurrencyUnit,
      ): Effect.Effect<ReadonlyArray<TokenRowId>> =>
        Effect.gen(function* () {
          const primary = live[0];
          if (primary === undefined) return [];
          const encoded = encodeProofs({
            mint,
            unit,
            memo: null,
            proofs: dedupeProofs(live.flatMap((entry) => entry.unspent)),
          });
          if (encoded === null) return [];
          if (encoded.tokenText !== primary.group.row.tokenText) {
            yield* rewriteRowTokenText(
              tokenStore,
              inspector,
              primary.group.row,
              encoded.tokenText,
              "validation",
            );
          }
          const siblings = live.slice(1);
          yield* Effect.forEach(
            siblings,
            (entry) => tokenStore.remove(entry.group.row.id),
            { discard: true },
          );
          return siblings.map((entry) => entry.group.row.id);
        });

      /**
       * Checks every `accepted` row — the wallet's balance. Emitted rows
       * (`issued`, `externalized`) belong to `checkIssued` and to their
       * holder; `pending` rows are still in flight.
       */
      const checkAll: Effect.Effect<ValidationReport> = Effect.gen(
        function* () {
          const rows = yield* tokenStore.loadAll;
          const markedSpent: SpentTokenReport[] = [];
          const mergedRows: TokenRowId[] = [];
          const unavailableMints: MintUrl[] = [];
          let checkedRows = 0;

          for (const group of groupRowsByMint(
            rows.filter((row) => row.state === "accepted"),
          )) {
            const partition = yield* checkMintRows(
              instances,
              group.mint,
              group.unit,
              group.rows,
            );
            if (partition === null) {
              unavailableMints.push(group.mint);
              continue;
            }
            checkedRows +=
              partition.live.length +
              partition.fullySpent.length +
              partition.unknown.length;
            for (const dead of partition.fullySpent) {
              yield* markRowSpent(dead.row, group.mint);
              markedSpent.push(spentReport(dead));
            }
            mergedRows.push(
              ...(yield* mergeLiveRows(partition.live, group.mint, group.unit)),
            );
          }

          return new ValidationReport({
            checkedRows,
            markedSpent,
            mergedRows,
            unavailableMints,
          });
        },
      ).pipe(inspectOperation(inspector, "validation.checkAll", {}));

      const checkRow = (
        rowId: TokenRowId,
      ): Effect.Effect<RowCheckResult, TokenRowNotFound> =>
        Effect.gen(function* () {
          const rows = yield* tokenStore.loadAll;
          const row = rows.find((candidate) => candidate.id === rowId);
          if (row === undefined) return yield* new TokenRowNotFound({ rowId });

          const [group] = groupRowsByMint([row]);
          // An undecodable row states no mint: nobody can be asked about it.
          if (group === undefined) {
            return new RowCheckResult({ rowId, status: "unavailable" });
          }
          const partition = yield* checkMintRows(
            instances,
            group.mint,
            group.unit,
            group.rows,
          );
          if (partition === null || partition.unknown.length > 0) {
            return new RowCheckResult({ rowId, status: "unavailable" });
          }
          const dead = partition.fullySpent[0];
          if (dead !== undefined) {
            yield* markRowSpent(dead.row, group.mint);
            return new RowCheckResult({ rowId, status: "spent" });
          }
          // A partially spent row keeps only what survived.
          yield* mergeLiveRows(partition.live, group.mint, group.unit);
          return new RowCheckResult({ rowId, status: "live" });
        }).pipe(inspectOperation(inspector, "validation.checkRow", { rowId }));

      /** Detect issued tokens the recipient has claimed, and prune them. */
      const checkIssued: Effect.Effect<IssuedClaimReport> = Effect.gen(
        function* () {
          const rows = yield* tokenStore.loadAll;
          const claimed: SpentTokenReport[] = [];
          for (const group of groupRowsByMint(
            rows.filter((row) => row.state === "issued"),
          )) {
            const partition = yield* checkMintRows(
              instances,
              group.mint,
              group.unit,
              group.rows,
            );
            if (partition === null) continue;
            for (const dead of partition.fullySpent) {
              yield* tokenStore.remove(dead.row.id);
              claimed.push(spentReport(dead));
            }
          }
          return new IssuedClaimReport({ claimed });
        },
      ).pipe(inspectOperation(inspector, "validation.checkIssued", {}));

      const inspectProofStates = Effect.flatMap(tokenStore.loadAll, (rows) =>
        inspectStoredProofStates(instances, rows),
      ).pipe(inspectOperation(inspector, "validation.inspectProofStates", {}));

      return { checkAll, checkRow, checkIssued, inspectProofStates } as const;
    }),
  },
) {}
