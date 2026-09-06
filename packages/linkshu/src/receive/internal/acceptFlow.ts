import type { Proof as CashuProof } from "@cashu/cashu-ts";
import { Effect, Either, Schema } from "effect";
import {
  MintRejected,
  TokenAlreadyKnown,
  TokenAlreadySpent,
  TokenParseFailed,
} from "../../domain/errors";
import type { CounterLockTimeout, MintUnreachable } from "../../domain/errors";
import { CurrencyUnit } from "../../domain/primitives";
import { sat } from "../../internal/units";
import type { Amount, MintUrl, TokenText } from "../../domain/primitives";
import { TokenLifecycleChanged } from "../../inspector/events";
import type { InspectorService } from "../../inspector/Inspector";
import { recoverFromCollision } from "../../internal/collisionRecovery";
import {
  advanceCounterTo,
  readCounter,
  withCounterLock,
} from "../../internal/counters";
import type { CounterScope } from "../../internal/counters";
import {
  isRecoverableOutputCollision,
  isTokenAlreadySpentError,
} from "../../internal/outputCollisions";
import {
  boundKeysetId,
  classifyMintError,
} from "../../mint/internal/WalletInstances";
import type {
  LoadedWallet,
  WalletInstances,
} from "../../mint/internal/WalletInstances";
import type { KeyValueStoreService } from "../../ports/KeyValueStore";
import type { StoredTokenRow, TokenStoreService } from "../../ports/TokenStore";
import { extractTokenText, parseTokenText } from "../../token/codec";
import { encodeCashuProofs } from "../../token/internal/cashuProofs";
import {
  findRowByTokenText,
  insertRowInState,
  isLegalTransition,
  transitionRow,
} from "../../token/internal/lifecycle";
import { ReceiveError, ReceiveReceipt } from "../domain";

const MAX_SWAP_ATTEMPTS = 5;
/** Fallback bump (one output block) when restore cannot locate the collision. */
const COLLISION_FALLBACK_BUMP = 64;

type AcceptFailure =
  | MintUnreachable
  | MintRejected
  | TokenAlreadySpent
  | CounterLockTimeout;

const isTransient = (error: AcceptFailure): boolean =>
  error._tag === "MintUnreachable" || error._tag === "CounterLockTimeout";

/** Serialized onto `error` rows; every member is a tagged Schema error. */
const encodeStoredError = Schema.encodeSync(Schema.parseJson(ReceiveError));

/** A token found in arbitrary text, decoded to what accepting it needs. */
export interface ReceivableToken {
  readonly tokenText: TokenText;
  readonly mint: MintUrl;
  readonly unit: CurrencyUnit;
  readonly memo: string | null;
  readonly amount: Amount;
}

export const parseReceivable = (
  text: string,
): Effect.Effect<ReceivableToken, TokenParseFailed> =>
  Effect.suspend(() => {
    if (text.trim() === "") {
      return new TokenParseFailed({ reason: "empty", detail: null });
    }
    const tokenText = extractTokenText(text);
    if (tokenText === null) {
      return new TokenParseFailed({ reason: "no-token-found", detail: null });
    }
    const parsed = parseTokenText(tokenText);
    if (parsed === null) {
      return new TokenParseFailed({ reason: "undecodable", detail: null });
    }
    if (parsed.mint === null) {
      return new TokenParseFailed({
        reason: "undecodable",
        detail: "token does not state its mint",
      });
    }
    return Effect.succeed({
      tokenText,
      mint: parsed.mint,
      unit: parsed.unit ?? sat,
      memo: parsed.memo,
      amount: parsed.amount,
    });
  });

/** Token text (draft and receipt encodings) carries proof secrets. */
export interface ReceiveContext {
  readonly kv: KeyValueStoreService;
  readonly tokenStore: TokenStoreService;
  readonly instances: WalletInstances;
  readonly inspector: InspectorService;
}

/**
 * The row whose encoding is being re-received (`Tokens.returnToWallet`): it
 * is ignored by dedup, removed once the fresh row holds the swapped proofs,
 * and carries a definitive failure instead of the fresh row.
 */
export interface ReplacedRow {
  readonly row: StoredTokenRow;
  /** Lifecycle-event reason for every row this re-receive touches. */
  readonly reason: string;
}

const swapAtMint = (
  ctx: ReceiveContext,
  wallet: LoadedWallet,
  scope: CounterScope,
  tokenText: TokenText,
): Effect.Effect<ReadonlyArray<CashuProof>, AcceptFailure> =>
  withCounterLock(
    ctx.kv,
    scope,
  )(
    Effect.gen(function* () {
      let counter = yield* readCounter(ctx.kv, scope);
      let lastCollision: unknown = null;
      for (let attempt = 0; attempt < MAX_SWAP_ATTEMPTS; attempt += 1) {
        const outcome = yield* Effect.either(
          Effect.tryPromise({
            try: () =>
              wallet.receive(tokenText, undefined, {
                type: "deterministic",
                counter,
              }),
            catch: (error): unknown => error,
          }),
        );
        if (Either.isRight(outcome)) {
          const proofs = outcome.right;
          yield* advanceCounterTo(
            ctx.kv,
            ctx.inspector,
            scope,
            counter + proofs.length,
            "used",
          );
          return proofs;
        }
        const raw = outcome.left;
        if (isTokenAlreadySpentError(raw)) {
          return yield* new TokenAlreadySpent({ mint: scope.mint });
        }
        if (!isRecoverableOutputCollision(raw)) {
          return yield* Effect.fail(classifyMintError(scope.mint, raw));
        }
        lastCollision = raw;
        counter = yield* recoverFromCollision(
          {
            kv: ctx.kv,
            inspector: ctx.inspector,
            wallet,
            scope,
            fallbackBump: COLLISION_FALLBACK_BUMP,
          },
          counter,
          raw,
        );
      }
      return yield* Effect.fail(classifyMintError(scope.mint, lastCollision));
    }),
  );

const acceptRow = (
  ctx: ReceiveContext,
  row: StoredTokenRow,
  parsed: ReceivableToken,
  reason: string,
): Effect.Effect<ReceiveReceipt, AcceptFailure> =>
  Effect.gen(function* () {
    const wallet = yield* ctx.instances.get(parsed.mint, parsed.unit);
    const keysetId = yield* boundKeysetId(parsed.mint, wallet);
    const scope: CounterScope = {
      mint: parsed.mint,
      unit: parsed.unit,
      keysetId,
    };
    const proofs = yield* swapAtMint(ctx, wallet, scope, parsed.tokenText);
    const encoded = encodeCashuProofs({
      mint: parsed.mint,
      unit: parsed.unit,
      memo: parsed.memo,
      proofs,
    });
    if (encoded === null) {
      return yield* new MintRejected({
        mint: parsed.mint,
        code: null,
        detail: "mint returned malformed proofs from the swap",
      });
    }
    // `pending` → `accepted` is always legal; failing here is a package bug.
    yield* Effect.orDie(
      transitionRow(ctx.tokenStore, ctx.inspector, row, "accepted", reason, {
        tokenText: encoded.tokenText,
      }),
    );
    return new ReceiveReceipt({
      rowId: row.id,
      tokenText: encoded.tokenText,
      mint: parsed.mint,
      unit: parsed.unit,
      amount: encoded.amount,
    });
  });

/**
 * Definitive spend knowledge lands on the row the caller holds, where the
 * state machine allows it: an `externalized` row left the app and a dead
 * `error` row is already marked, so both only keep their state.
 */
const markRowFailed = (
  ctx: ReceiveContext,
  row: StoredTokenRow,
  error: AcceptFailure,
  reason: string,
): Effect.Effect<void> =>
  isLegalTransition(row.state, "error")
    ? Effect.orDie(
        transitionRow(ctx.tokenStore, ctx.inspector, row, "error", reason, {
          error: encodeStoredError(error),
        }),
      )
    : Effect.void;

/**
 * Undoes what the insert clobbered when the store handed it the replaced
 * row's own id: a raw store write back to the pre-flow snapshot, not a
 * domain transition — the row never legally left its state (`pending` →
 * `issued` has no place in the state machine).
 */
const restoreReplacedRow = (
  ctx: ReceiveContext,
  replaced: ReplacedRow,
): Effect.Effect<void> =>
  ctx.tokenStore
    .update(replaced.row.id, {
      state: replaced.row.state,
      tokenText: replaced.row.tokenText,
      error: replaced.row.error,
    })
    .pipe(
      Effect.tap(() =>
        Effect.sync(() =>
          ctx.inspector.emit(
            () =>
              new TokenLifecycleChanged(
                {
                  rowId: replaced.row.id,
                  from: "pending",
                  to: replaced.row.state,
                  reason: replaced.reason,
                },
                { disableValidation: true },
              ),
          ),
        ),
      ),
    );

const settleFailedRow = (
  ctx: ReceiveContext,
  row: StoredTokenRow,
  replaced: ReplacedRow | null,
  error: AcceptFailure,
  reason: string,
): Effect.Effect<never, AcceptFailure> => {
  // A transient failure leaves nothing behind, so a replaced row survives it
  // untouched; a definitive one is recorded on the row the caller holds.
  // When the store gave the insert the replaced row's own id, the fresh and
  // replaced rows are one physical row holding the funds: it is never
  // removed, only marked failed or restored to its pre-flow snapshot.
  const settle =
    replaced !== null && replaced.row.id === row.id
      ? isTransient(error) || !isLegalTransition(replaced.row.state, "error")
        ? restoreReplacedRow(ctx, replaced)
        : markRowFailed(ctx, replaced.row, error, reason)
      : isTransient(error)
        ? ctx.tokenStore.remove(row.id)
        : replaced === null
          ? markRowFailed(ctx, row, error, reason)
          : Effect.zipRight(
              ctx.tokenStore.remove(row.id),
              markRowFailed(ctx, replaced.row, error, reason),
            );
  return Effect.zipRight(settle, Effect.fail(error));
};

/**
 * Receiving a token is one call: extract and decode the text, dedup against
 * stored rows by token text, re-sign the proofs at the mint with
 * deterministic outputs (recovering counter collisions via targeted NUT-09
 * lookups), and persist the row through its lifecycle (fresh → `accepted`,
 * or `error` carrying the serialized failure on definitive rejection —
 * transient failures leave no `error` row behind).
 *
 * Re-receiving (`replaced`) follows the same path, and the replaced row only
 * goes away once the fresh proofs are stored: funds are never outside the
 * store, not even for the length of a swap.
 */
export const receiveTokenText = (
  ctx: ReceiveContext,
  text: string,
  replaced: ReplacedRow | null,
): Effect.Effect<ReceiveReceipt, ReceiveError> =>
  Effect.gen(function* () {
    const reason = replaced?.reason ?? "receive";
    const parsed = yield* parseReceivable(text);
    const rows = yield* ctx.tokenStore.loadAll;
    const known = findRowByTokenText(
      rows.filter((row) => row.id !== replaced?.row.id),
      parsed.tokenText,
    );
    if (known !== null) {
      return yield* new TokenAlreadyKnown({ rowId: known.id });
    }
    const row = yield* insertRowInState(ctx.tokenStore, ctx.inspector, {
      originalTokenText: parsed.tokenText,
      tokenText: parsed.tokenText,
      state: "pending",
      reason,
    });
    return yield* acceptRow(ctx, row, parsed, reason).pipe(
      // A store deriving ids from `originalTokenText` hands the insert the
      // replaced row's own id; that one physical row already superseded it.
      Effect.tap(() =>
        replaced === null || replaced.row.id === row.id
          ? Effect.void
          : ctx.tokenStore.remove(replaced.row.id),
      ),
      Effect.catchAll((error) =>
        settleFailedRow(ctx, row, replaced, error, reason),
      ),
    );
  });
