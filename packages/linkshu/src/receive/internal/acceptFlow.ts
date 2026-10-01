import type { Proof as CashuProof, SwapPreview } from "@cashu/cashu-ts";
import { Effect, Either, Schema } from "effect";
import {
  AmountConsumedByFee,
  MintRejected,
  MintUnreachable,
  TokenAlreadyKnown,
  TokenAlreadySpent,
  TokenParseFailed,
} from "../../domain/errors";
import type { CounterLockTimeout } from "../../domain/errors";
import { Amount, CurrencyUnit, UnixSeconds } from "../../domain/primitives";
import { sat } from "../../internal/units";
import type { KeysetId, MintUrl, TokenText } from "../../domain/primitives";
import type { InspectorService } from "../../inspector/Inspector";
import { recoverFromCollision } from "../../internal/collisionRecovery";
import {
  advanceCounterTo,
  readCounter,
  withCounterLock,
} from "../../internal/counters";
import type { CounterScope } from "../../internal/counters";
import {
  insertOperation,
  inspectOperationWith,
  patchOperation,
} from "../../internal/operations";
import {
  isRecoverableOutputCollision,
  isTokenAlreadySpentError,
} from "../../internal/outputCollisions";
import {
  insertProofs,
  setProofState,
  storedSecrets,
  toNewProofs,
} from "../../internal/proofs";
import {
  checkProofStates,
  spentSecrets,
  unspentProofs,
} from "../../internal/proofStates";
import { nowSeconds } from "../../internal/time";
import { inputFeeForProofs } from "../../mint/internal/keysetFees";
import {
  boundKeysetId,
  classifyMintError,
} from "../../mint/internal/WalletInstances";
import type {
  LoadedWallet,
  WalletInstances,
} from "../../mint/internal/WalletInstances";
import type { KeyValueStoreService } from "../../ports/KeyValueStore";
import { NewOperation, StoredOperation } from "../../ports/OperationStore";
import type { OperationStoreService } from "../../ports/OperationStore";
import type { ProofStoreService, StoredProof } from "../../ports/ProofStore";
import {
  decodeTokenText,
  extractTokenText,
  parseTokenText,
} from "../../token/codec";
import type { DecodedToken, Proof } from "../../token/domain";
import {
  encodeCashuProofs,
  toDomainProofs,
} from "../../token/internal/cashuProofs";
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

/** Serialized onto failed transfers; every member is a tagged Schema error. */
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
  readonly proofStore: ProofStoreService;
  readonly operationStore: OperationStoreService;
  readonly instances: WalletInstances;
  readonly inspector: InspectorService;
}

/**
 * The transfer whose text is being re-received (`Tokens.returnToWallet`):
 * ignored by dedup, and the one that carries the outcome. A failed
 * `receive` is retried in place; a `send` is taken back, its handed-out
 * proofs dying at the mint the moment the fresh ones are signed.
 */
export interface ReplacedTransfer {
  readonly operation: StoredOperation;
  /** Inspector reason for everything this re-receive touches. */
  readonly reason: string;
}

const prepareSwap = (
  wallet: LoadedWallet,
  mint: MintUrl,
  tokenText: TokenText,
  keysetId: KeysetId,
  counter: number,
): Effect.Effect<SwapPreview, MintUnreachable | MintRejected> =>
  Effect.tryPromise({
    try: () =>
      wallet.prepareSwapToReceive(
        tokenText,
        { keysetId },
        { type: "deterministic", counter },
      ),
    catch: (error) => classifyMintError(mint, error),
  });

const outputCount = (preview: SwapPreview): number =>
  (preview.keepOutputs?.length ?? 0) + (preview.sendOutputs?.length ?? 0);

/**
 * Swaps under the caller's counter lock. Each attempt burns its whole output
 * range, then reports its first slot through `onAttempt`, before the
 * request leaves, so whatever the mint signed in that range belongs to this
 * swap alone and restores after a lost response or a reload.
 */
const swapAtMint = (
  ctx: ReceiveContext,
  wallet: LoadedWallet,
  scope: CounterScope,
  tokenText: TokenText,
  onAttempt: (counter: number) => Effect.Effect<void>,
): Effect.Effect<ReadonlyArray<CashuProof>, AcceptFailure> =>
  Effect.gen(function* () {
    let lastCollision: unknown = null;
    for (let attempt = 0; attempt < MAX_SWAP_ATTEMPTS; attempt += 1) {
      const counter = yield* readCounter(ctx.kv, scope);
      const preview = yield* prepareSwap(
        wallet,
        scope.mint,
        tokenText,
        scope.keysetId,
        counter,
      );
      // Burned before it is recorded: a recorded slot must never be reused.
      yield* advanceCounterTo(
        ctx.kv,
        ctx.inspector,
        scope,
        counter + outputCount(preview),
        "used",
      );
      yield* onAttempt(counter);
      const outcome = yield* Effect.either(
        Effect.tryPromise({
          try: () => wallet.completeSwap(preview),
          catch: (error): unknown => error,
        }),
      );
      if (Either.isRight(outcome)) return outcome.right.keep;
      const raw = outcome.left;
      if (isTokenAlreadySpentError(raw)) {
        return yield* new TokenAlreadySpent({ mint: scope.mint });
      }
      if (!isRecoverableOutputCollision(raw)) {
        return yield* Effect.fail(classifyMintError(scope.mint, raw));
      }
      lastCollision = raw;
      yield* recoverFromCollision(
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
  });

/**
 * What the mint signed for the transfer's latest attempt, re-derived from its
 * persisted slot via NUT-09. Empty when that attempt never reached the mint.
 */
const restoreLatestAttempt = (
  ctx: ReceiveContext,
  wallet: LoadedWallet,
  transfer: StoredOperation,
): Effect.Effect<ReadonlyArray<CashuProof>, MintUnreachable | MintRejected> =>
  Effect.gen(function* () {
    const { counter, keysetId, mint, tokenText } = transfer;
    if (counter === null || keysetId === null || tokenText === null) return [];
    const preview = yield* prepareSwap(
      wallet,
      mint,
      tokenText,
      keysetId,
      counter,
    );
    const restored = yield* Effect.tryPromise({
      try: () => wallet.restore(counter, outputCount(preview), { keysetId }),
      catch: (error) => classifyMintError(mint, error),
    }).pipe(
      inspectOperationWith(
        ctx.inspector,
        "receive.restoreAttempt",
        { mint, operationId: transfer.id, counter },
        ({ proofs }) => ({ proofs: proofs.length }),
      ),
    );
    return restored.proofs;
  });

const malformedSwapProofs = (mint: MintUrl): MintRejected =>
  new MintRejected({
    mint,
    code: null,
    detail: "mint returned malformed proofs from the swap",
  });

const unanswered = (mint: MintUrl): MintUnreachable =>
  new MintUnreachable({
    mint,
    detail: "mint did not report the state of every proof",
  });

/**
 * Splits `proofs` by the mint's NUT-07 answer; any proof it left unanswered
 * fails the whole check, so a receive never closes on a guess.
 */
const answeredStates = (
  wallet: LoadedWallet,
  mint: MintUrl,
  proofs: ReadonlyArray<Proof>,
): Effect.Effect<
  {
    readonly spent: ReadonlySet<string>;
    readonly unspent: ReadonlySet<string>;
  },
  MintUnreachable | MintRejected
> =>
  Effect.gen(function* () {
    const states = yield* checkProofStates(wallet, mint, proofs);
    const spent = spentSecrets(proofs, states);
    const unspent = new Set(
      unspentProofs(proofs, states).map((proof) => proof.secret),
    );
    if (spent.size + unspent.size < proofs.length) {
      return yield* unanswered(mint);
    }
    return { spent, unspent };
  });

/**
 * Restored proofs the inventory still lacks and the mint reports unspent, so
 * a crash between storing them and closing the transfer cannot import them
 * twice.
 */
const unstoredUnspent = (
  ctx: ReceiveContext,
  wallet: LoadedWallet,
  mint: MintUrl,
  proofs: ReadonlyArray<CashuProof>,
): Effect.Effect<ReadonlyArray<CashuProof>, MintUnreachable | MintRejected> =>
  Effect.gen(function* () {
    const known = storedSecrets(yield* ctx.proofStore.loadAll);
    const unstored = proofs.filter((proof) => !known.has(proof.secret));
    const decoded = toDomainProofs(unstored);
    if (decoded === null) return yield* malformedSwapProofs(mint);
    const { unspent } = yield* answeredStates(wallet, mint, decoded);
    return unstored.filter((proof) => unspent.has(proof.secret));
  });

/**
 * Outputs at the recorded slot are this receive's only if the mint spent the
 * token: another device may have signed that slot for something else while
 * this receive never reached the mint.
 */
const isTokenSpent = (
  wallet: LoadedWallet,
  mint: MintUrl,
  inputs: ReadonlyArray<Proof> | null,
): Effect.Effect<boolean, MintUnreachable | MintRejected> =>
  inputs === null
    ? Effect.succeed(true)
    : Effect.map(
        answeredStates(wallet, mint, inputs),
        ({ spent }) => spent.size === inputs.length,
      );

/** Stores `fresh` as balance; the receipt encodes everything the mint signed. */
const keepSigned = (
  ctx: ReceiveContext,
  parsed: ReceivableToken,
  signed: ReadonlyArray<CashuProof>,
  fresh: ReadonlyArray<CashuProof>,
  reason: string,
): Effect.Effect<AcceptedToken, MintRejected> =>
  Effect.gen(function* () {
    const encoded = encodeCashuProofs({
      mint: parsed.mint,
      unit: parsed.unit,
      memo: parsed.memo,
      proofs: signed,
    });
    const rows = toNewProofs(
      fresh,
      parsed.mint,
      parsed.unit,
      "available",
      null,
    );
    if (encoded === null || rows === null) {
      return yield* malformedSwapProofs(parsed.mint);
    }
    yield* insertProofs(ctx, rows, reason);
    return { tokenText: encoded.tokenText, amount: encoded.amount };
  });

interface AcceptedToken {
  readonly tokenText: TokenText;
  readonly amount: Amount;
}

/**
 * Accepts under the caller's counter lock. A transfer whose earlier attempt
 * the mint already signed is finished from the restored outputs; otherwise
 * the token is swapped, each attempt's slot persisted on the transfer.
 */
const acceptUnderLock = (
  ctx: ReceiveContext,
  wallet: LoadedWallet,
  scope: CounterScope,
  parsed: ReceivableToken,
  /** The token's proofs, when the text decodes. */
  inputs: ReadonlyArray<Proof> | null,
  transfer: StoredOperation | null,
  reason: string,
): Effect.Effect<AcceptedToken, AcceptFailure> =>
  Effect.gen(function* () {
    const restored =
      transfer === null
        ? []
        : yield* restoreLatestAttempt(ctx, wallet, transfer).pipe(
            // A mint that will not restore leaves nothing to recover from.
            Effect.catchTag("MintRejected", () => Effect.succeed([])),
          );
    if (
      restored.length > 0 &&
      (yield* isTokenSpent(wallet, parsed.mint, inputs))
    ) {
      const fresh = yield* unstoredUnspent(ctx, wallet, parsed.mint, restored);
      return yield* keepSigned(ctx, parsed, restored, fresh, reason);
    }
    const swapped = yield* swapAtMint(
      ctx,
      wallet,
      scope,
      parsed.tokenText,
      (counter) =>
        transfer === null
          ? Effect.void
          : patchOperation(
              ctx,
              transfer,
              { keysetId: scope.keysetId, counter },
              reason,
            ),
    );
    return yield* keepSigned(ctx, parsed, swapped, swapped, reason);
  });

const counterScopeFor = (
  wallet: LoadedWallet,
  parsed: ReceivableToken,
): Effect.Effect<CounterScope, MintRejected> =>
  Effect.map(boundKeysetId(parsed.mint, wallet), (keysetId) => ({
    mint: parsed.mint,
    unit: parsed.unit,
    keysetId,
  }));

/** Re-signs the token at the mint and stores the fresh proofs as balance. */
export const acceptAtMint = (
  ctx: ReceiveContext,
  wallet: LoadedWallet,
  parsed: ReceivableToken,
  reason: string,
): Effect.Effect<AcceptedToken, AcceptFailure> =>
  Effect.flatMap(counterScopeFor(wallet, parsed), (scope) =>
    withCounterLock(
      ctx.kv,
      scope,
    )(acceptUnderLock(ctx, wallet, scope, parsed, null, null, reason)),
  );

/** Proofs a transfer handed out and still accounts for. */
const proofsOf = (
  proofs: ReadonlyArray<StoredProof>,
  operation: StoredOperation,
): ReadonlyArray<StoredProof> =>
  proofs.filter(
    (proof) =>
      proof.operationId === operation.id &&
      (proof.state === "handedOut" || proof.state === "externalized"),
  );

const isTransfer = (operation: StoredOperation): boolean =>
  operation.kind === "send" || operation.kind === "receive";

const isFailedReceive = (operation: StoredOperation): boolean =>
  operation.kind === "receive" && operation.status === "failed";

/**
 * Dedup: the text is known when a transfer carries it, or when any of its
 * proofs is already in the inventory — a token whose proofs the wallet
 * holds must not be swapped a second time, or the stored copies die. A
 * failed receive holds nothing, so its text is free to be tried again.
 */
const findKnown = (
  operations: ReadonlyArray<StoredOperation>,
  proofs: ReadonlyArray<StoredProof>,
  tokenText: TokenText,
  replaced: StoredOperation | null,
  /** The token's proofs, when the text decodes. */
  decoded: DecodedToken | null,
): TokenAlreadyKnown | null => {
  const transfer = operations.find(
    (operation) =>
      isTransfer(operation) &&
      operation.tokenText === tokenText &&
      operation.id !== replaced?.id &&
      !isFailedReceive(operation),
  );
  if (transfer !== undefined) {
    return new TokenAlreadyKnown({ operationId: transfer.id });
  }
  if (decoded === null) return null;
  const secrets = new Set(decoded.proofs.map((proof) => proof.secret));
  const stored = proofs.find(
    (proof) =>
      secrets.has(proof.secret) &&
      (replaced === null || proof.operationId !== replaced.id),
  );
  return stored === undefined
    ? null
    : new TokenAlreadyKnown({ operationId: stored.operationId });
};

/**
 * A retried receive starts over as `pending`; a send is taken back as it
 * stands. Returns the transfer as now stored, so later patches report the
 * transition they actually make.
 */
const reopen = (
  ctx: ReceiveContext,
  transfer: StoredOperation,
  reason: string,
): Effect.Effect<StoredOperation> => {
  if (transfer.kind !== "receive") return Effect.succeed(transfer);
  const patch = { status: "pending", error: null } as const;
  return Effect.as(
    patchOperation(ctx, transfer, patch, reason),
    new StoredOperation({ ...transfer, ...patch }),
  );
};

const pendingReceive = (
  parsed: ReceivableToken,
  createdAt: UnixSeconds,
): NewOperation =>
  new NewOperation({
    kind: "receive",
    status: "pending",
    mint: parsed.mint,
    unit: parsed.unit,
    keysetId: null,
    amount: parsed.amount,
    feeReserve: null,
    inputsTotal: null,
    quoteId: null,
    invoice: null,
    sourceMint: null,
    counter: null,
    locked: null,
    expiresAt: null,
    createdAt,
    tokenText: parsed.tokenText,
    error: null,
  });

/**
 * A transfer still waiting on this flow: a `send` not yet claimed or taken
 * back, or a receive that never finished (`pending` when a reload or crash
 * cut it short, `failed` when its last attempt failed).
 */
const isUnfinished = (operation: StoredOperation): boolean =>
  operation.kind === "send"
    ? operation.status === "issued" ||
      operation.status === "pending" ||
      operation.status === "externalized"
    : operation.kind === "receive" && operation.status !== "done";

/**
 * The transfer this receive continues, read under the counter lock: the
 * replaced one as stored now, or an unfinished receive of the same text,
 * resumed in place so the slot of its last attempt is not lost.
 */
const findReopened = (
  operations: ReadonlyArray<StoredOperation>,
  tokenText: TokenText,
  replaced: ReplacedTransfer | null,
): StoredOperation | undefined =>
  operations.find((operation) =>
    replaced === null
      ? operation.kind === "receive" &&
        operation.tokenText === tokenText &&
        isUnfinished(operation)
      : operation.id === replaced.operation.id && isUnfinished(operation),
  );

/**
 * Receiving a token is one call: extract and decode the text, dedup against
 * stored transfers and proofs, persist a `pending` receive, re-sign the
 * proofs at the mint with deterministic outputs (recovering counter
 * collisions via targeted NUT-09 lookups), store them as `available`, and
 * close the receive as `done` — or `failed`, carrying the serialized error,
 * so that pasting the text again retries it.
 *
 * Everything after the mint's keysets load runs under the counter lock, so
 * two contexts receiving one token see each other's outcome. Each swap
 * attempt persists its output slot on the transfer before it reaches the
 * mint: receiving the text of an unfinished receive resumes it, taking the
 * outputs from NUT-09 when the mint already signed them.
 *
 * Re-receiving (`replaced`) follows the same path over the replaced transfer
 * instead of a fresh one: a failed `receive` is retried in place; a `send`'s
 * handed-out proofs are marked `spent` and the send `returned` only once the
 * fresh proofs are stored, so funds are never outside the store.
 */
export const receiveTokenText = (
  ctx: ReceiveContext,
  text: string,
  replaced: ReplacedTransfer | null,
): Effect.Effect<ReceiveReceipt, ReceiveError> =>
  Effect.gen(function* () {
    const reason = replaced?.reason ?? "receive";
    const parsed = yield* parseReceivable(text);
    // The mint's keysets decide dedup (short v2 ids in v4 text) and the fee,
    // so a mint that will not load ends the receive before anything is recorded.
    const wallet = yield* ctx.instances.get(parsed.mint, parsed.unit);
    const scope = yield* counterScopeFor(wallet, parsed);
    return yield* withCounterLock(
      ctx.kv,
      scope,
    )(
      Effect.gen(function* () {
        const operations = yield* ctx.operationStore.loadAll;
        const proofs = yield* ctx.proofStore.loadAll;
        const keysetIds = wallet.keyChain
          .getKeysets()
          .map((keyset) => keyset.id);
        const decoded =
          decodeTokenText(parsed.tokenText, keysetIds) ??
          decodeTokenText(parsed.tokenText);
        const reopened =
          findReopened(operations, parsed.tokenText, replaced) ?? null;
        // Another context finished the replaced transfer while this one
        // waited for the lock.
        if (replaced !== null && reopened === null) {
          return yield* new TokenAlreadyKnown({
            operationId: replaced.operation.id,
          });
        }
        const known = findKnown(
          operations,
          proofs,
          parsed.tokenText,
          reopened,
          decoded,
        );
        if (known !== null) return yield* known;
        // A swap signs what is left after the mint's input fee. A token worth
        // no more than that fee has nothing to sign, and no wallet can redeem
        // it on its own, so it is refused before anything is recorded.
        const fee = inputFeeForProofs(wallet, decoded?.proofs ?? []);
        if (parsed.amount <= fee) {
          return yield* new AmountConsumedByFee({
            mint: parsed.mint,
            amount: parsed.amount,
            fee: Amount.make(fee),
          });
        }

        const transfer =
          reopened === null
            ? yield* insertOperation(
                ctx,
                pendingReceive(parsed, UnixSeconds.make(yield* nowSeconds)),
                reason,
              )
            : yield* reopen(ctx, reopened, reason);

        const accepted = yield* Effect.either(
          acceptUnderLock(
            ctx,
            wallet,
            scope,
            parsed,
            decoded?.proofs ?? null,
            transfer,
            reason,
          ),
        );
        if (Either.isLeft(accepted)) {
          const error = accepted.left;
          if (transfer.kind === "receive") {
            yield* patchOperation(
              ctx,
              transfer,
              { status: "failed", error: encodeStoredError(error) },
              reason,
            );
          } else if (!isTransient(error)) {
            // Definitive knowledge about a handed-out token: spent means the
            // recipient claimed it; any other rejection is only recorded.
            const claimed = error._tag === "TokenAlreadySpent";
            if (claimed) {
              yield* setProofState(
                ctx,
                proofsOf(proofs, transfer),
                "spent",
                reason,
              );
            }
            yield* patchOperation(
              ctx,
              transfer,
              {
                ...(claimed ? { status: "done" } : {}),
                error: encodeStoredError(error),
              },
              reason,
            );
          }
          return yield* Effect.fail(error);
        }

        if (transfer.kind === "receive") {
          yield* patchOperation(
            ctx,
            transfer,
            { status: "done", error: null },
            reason,
          );
        } else {
          yield* setProofState(
            ctx,
            proofsOf(proofs, transfer),
            "spent",
            reason,
          );
          yield* patchOperation(
            ctx,
            transfer,
            { status: "returned", error: null },
            reason,
          );
        }
        return new ReceiveReceipt({
          operationId: transfer.id,
          tokenText: accepted.right.tokenText,
          mint: parsed.mint,
          unit: parsed.unit,
          amount: accepted.right.amount,
        });
      }),
    );
  });
