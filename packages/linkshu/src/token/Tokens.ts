import { Effect, Schema } from "effect";
import { parseTokenText } from "./codec";
import {
  InvalidTokenTransition,
  MintBalance,
  WalletBalances,
  WalletToken,
} from "./domain";
import type { TokenState } from "./domain";
import { transitionRow } from "./internal/lifecycle";
import { totalProofAmount } from "./internal/rowProofs";
import { TokenRowNotFound } from "../domain/errors";
import { Amount, NonNegativeAmount, TokenRowId } from "../domain/primitives";
import type { MintUrl } from "../domain/primitives";
import { Inspector } from "../inspector/Inspector";
import {
  inspectOperation,
  inspectOperationWith,
  redactReceipt,
} from "../internal/operations";
import { checkMintRows, groupRowsByMint } from "../internal/rowStates";
import { WalletInstances } from "../mint/internal/WalletInstances";
import { KeyValueStore } from "../ports/KeyValueStore";
import { TokenStore } from "../ports/TokenStore";
import type { StoredTokenRow } from "../ports/TokenStore";
import { ReceiveReceipt } from "../receive/domain";
import type { ReceiveError } from "../receive/domain";
import {
  parseReceivable,
  receiveTokenText,
} from "../receive/internal/acceptFlow";
import type { ReceiveContext } from "../receive/internal/acceptFlow";

export class DeletedSpentToken extends Schema.Class<DeletedSpentToken>(
  "DeletedSpentToken",
)({
  rowId: TokenRowId,
  amount: Amount,
}) {}

const enrich = (row: StoredTokenRow): WalletToken | null => {
  const parsed = parseTokenText(row.tokenText);
  if (parsed === null) return null;
  return new WalletToken({
    id: row.id,
    state: row.state,
    tokenText: row.tokenText,
    mint: parsed.mint,
    unit: parsed.unit,
    amount: parsed.amount,
    error: row.error,
    createdAt: row.createdAt,
  });
};

/**
 * Read model and lifecycle transitions over the stored rows. The transition
 * functions are the only way rows change state outside the operation
 * verticals — platforms never write states themselves.
 */
export class Tokens extends Effect.Service<Tokens>()("linkshu/Tokens", {
  dependencies: [WalletInstances.Default],
  effect: Effect.gen(function* () {
    const tokenStore = yield* TokenStore;
    const instances = yield* WalletInstances;
    const inspector = yield* Inspector.orNoop;
    const receiveContext: ReceiveContext = {
      kv: yield* KeyValueStore,
      tokenStore,
      instances,
      inspector,
    };

    /**
     * All live rows enriched with metadata derived from their token text,
     * newest first. A row whose text no longer parses holds nothing anyone
     * can display or spend, so it is left in the store but out of the list.
     */
    const list: Effect.Effect<ReadonlyArray<WalletToken>> = Effect.map(
      tokenStore.loadAll,
      (rows) =>
        rows
          .flatMap((row) => {
            const token = enrich(row);
            return token === null ? [] : [token];
          })
          .sort((a, b) => b.createdAt - a.createdAt),
    );

    const balances: Effect.Effect<WalletBalances> = Effect.map(
      tokenStore.loadAll,
      (rows) => {
        const perMint = new Map<MintUrl, number>();
        for (const row of rows) {
          if (row.state !== "accepted") continue;
          const parsed = parseTokenText(row.tokenText);
          if (parsed === null || parsed.mint === null) continue;
          perMint.set(
            parsed.mint,
            (perMint.get(parsed.mint) ?? 0) + parsed.amount,
          );
        }
        const amounts = [...perMint.values()];
        return new WalletBalances({
          total: NonNegativeAmount.make(amounts.reduce((a, b) => a + b, 0)),
          spendable: NonNegativeAmount.make(Math.max(0, ...amounts)),
          perMint: [...perMint].map(
            ([mint, amount]) =>
              new MintBalance({
                mint,
                amount: NonNegativeAmount.make(amount),
              }),
          ),
        });
      },
    );

    const requireRow = (
      rowId: TokenRowId,
    ): Effect.Effect<StoredTokenRow, TokenRowNotFound> =>
      Effect.flatMap(tokenStore.loadAll, (rows) => {
        const row = rows.find((candidate) => candidate.id === rowId);
        return row === undefined
          ? Effect.fail(new TokenRowNotFound({ rowId }))
          : Effect.succeed(row);
      });

    /** Every pure transition: one lookup, then the state machine. */
    const transition = (
      rowId: TokenRowId,
      to: TokenState,
      operation: string,
    ): Effect.Effect<void, TokenRowNotFound | InvalidTokenTransition> =>
      requireRow(rowId).pipe(
        Effect.flatMap((row) =>
          transitionRow(tokenStore, inspector, row, to, operation),
        ),
        inspectOperation(inspector, `tokens.${operation}`, { rowId }),
      );

    /** `accepted` → `reserved`: earmark a row for a pending handover. */
    const reserve = (rowId: TokenRowId) =>
      transition(rowId, "reserved", "reserve");

    /** `accepted` | `reserved` → `issued`: the token left as a QR/share. */
    const markIssued = (rowId: TokenRowId) =>
      transition(rowId, "issued", "markIssued");

    /** → `externalized`: the token was handed off outside the app. */
    const markExternalized = (rowId: TokenRowId) =>
      transition(rowId, "externalized", "markExternalized");

    /** A reserved encoding never left the device, so the earmark just drops. */
    const dropReservation = (
      row: StoredTokenRow,
    ): Effect.Effect<ReceiveReceipt, ReceiveError> =>
      Effect.gen(function* () {
        const parsed = yield* parseReceivable(row.tokenText);
        // `reserved` → `accepted` is always legal; failing here is a bug.
        yield* Effect.orDie(
          transitionRow(
            tokenStore,
            inspector,
            row,
            "accepted",
            "returnToWallet",
          ),
        );
        return new ReceiveReceipt({
          rowId: row.id,
          tokenText: parsed.tokenText,
          mint: parsed.mint,
          unit: parsed.unit,
          amount: parsed.amount,
        });
      });

    /**
     * Bring an emitted or errored row back to `accepted`. Everything that
     * was handed out is re-received, so the encoding somebody else may hold
     * dies at the mint; only the replaced row's own fate differs from a
     * plain receive (see `receiveTokenText`).
     */
    const returnToWallet = (
      rowId: TokenRowId,
    ): Effect.Effect<
      ReceiveReceipt,
      ReceiveError | TokenRowNotFound | InvalidTokenTransition
    > =>
      Effect.gen(function* () {
        const row = yield* requireRow(rowId);
        if (row.state === "accepted") {
          return yield* new InvalidTokenTransition({
            rowId,
            from: row.state,
            to: "accepted",
          });
        }
        return yield* row.state === "reserved"
          ? dropReservation(row)
          : receiveTokenText(receiveContext, row.tokenText, {
              row,
              reason: "returnToWallet",
            });
      }).pipe(
        inspectOperationWith(
          inspector,
          "tokens.returnToWallet",
          { rowId },
          redactReceipt,
        ),
      );

    /**
     * Remove every row NUT-07 has definitively marked spent: own balance
     * (`accepted`) and failed rows (`error`), never rows whose funds are
     * out with someone else — pruning those is `Validation.checkIssued`'s
     * job. A mint that cannot be reached, or that leaves a proof
     * unanswered, keeps its rows. Rows already carrying a recorded spend
     * error are re-confirmed too: receive writes `TokenAlreadySpent` when
     * a swap is rejected over a *partially* spent token, whose text still
     * holds live proofs.
     */
    const deleteSpent: Effect.Effect<ReadonlyArray<DeletedSpentToken>> =
      Effect.gen(function* () {
        const deleted: DeletedSpentToken[] = [];
        const candidates = (yield* tokenStore.loadAll).filter(
          (row) => row.state === "accepted" || row.state === "error",
        );

        for (const group of groupRowsByMint(candidates)) {
          const partition = yield* checkMintRows(
            instances,
            group.mint,
            group.unit,
            group.rows,
          );
          if (partition === null) continue;
          for (const dead of partition.fullySpent) {
            yield* tokenStore.remove(dead.row.id);
            deleted.push(
              new DeletedSpentToken({
                rowId: dead.row.id,
                amount: Amount.make(totalProofAmount(dead.proofs)),
              }),
            );
          }
        }
        return deleted;
      }).pipe(inspectOperation(inspector, "tokens.deleteSpent", {}));

    return {
      list,
      balances,
      reserve,
      markIssued,
      markExternalized,
      returnToWallet,
      deleteSpent,
    } as const;
  }),
}) {}
