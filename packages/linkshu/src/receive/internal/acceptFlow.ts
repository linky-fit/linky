import type { Proof as CashuProof, SwapPreview } from "@cashu/cashu-ts";
import { Duration, Effect, Either, Ref, Schema } from "effect";
import {
  AmountConsumedByFee,
  CounterLockTimeout,
  MintRejected,
  MintUnreachable,
  ReceiveDeferred,
  TokenAlreadyKnown,
  TokenAlreadySpent,
  TokenParseFailed,
} from "../../domain/errors";
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
import { withKeyLease } from "../../internal/lease";
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
import type {
  OperationPatch,
  OperationStoreService,
} from "../../ports/OperationStore";
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
  inputs: ReadonlyArray<Proof>,
): Effect.Effect<boolean, MintUnreachable | MintRejected> =>
  Effect.map(
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
 * Finishes `transfer` from the outputs of its recorded attempt when the mint
 * signed them and spent the token; null otherwise.
 */
const finishFromRestore = (
  ctx: ReceiveContext,
  wallet: LoadedWallet,
  parsed: ReceivableToken,
  /** Asked only once the slot restored something. */
  tokenSpent: Effect.Effect<boolean, MintUnreachable | MintRejected>,
  transfer: StoredOperation | null,
  reason: string,
): Effect.Effect<AcceptedToken | null, MintUnreachable | MintRejected> =>
  Effect.gen(function* () {
    const restored =
      transfer === null
        ? []
        : yield* restoreLatestAttempt(ctx, wallet, transfer).pipe(
            // A mint that will not restore leaves nothing to recover from.
            Effect.catchTag("MintRejected", () => Effect.succeed([])),
          );
    if (restored.length === 0 || !(yield* tokenSpent)) return null;
    const fresh = yield* unstoredUnspent(ctx, wallet, parsed.mint, restored);
    return yield* keepSigned(ctx, parsed, restored, fresh, reason);
  });

/**
 * Swaps the token under the caller's counter lock, each attempt's slot
 * persisted on `transfer`, and stores what the mint signed.
 */
const swapAndKeep = (
  ctx: ReceiveContext,
  wallet: LoadedWallet,
  scope: CounterScope,
  parsed: ReceivableToken,
  transfer: StoredOperation | null,
  reason: string,
): Effect.Effect<AcceptedToken, AcceptFailure> =>
  Effect.gen(function* () {
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

const advertisesStateCheck = (wallet: LoadedWallet): boolean =>
  wallet.getMintInfo().isSupported(7).supported;

/**
 * Accepts a token the mint was not asked about, under the caller's counter
 * lock: a transfer whose earlier attempt the mint already signed is finished
 * from the restored outputs; otherwise the token is swapped. Without NUT-07
 * nothing proves restored outputs are this transfer's, so it always swaps.
 */
const acceptUnchecked = (
  ctx: ReceiveContext,
  wallet: LoadedWallet,
  scope: CounterScope,
  parsed: ReceivableToken,
  inputs: ReadonlyArray<Proof>,
  transfer: StoredOperation,
  reason: string,
): Effect.Effect<AcceptedToken, AcceptFailure> =>
  Effect.gen(function* () {
    const restored = advertisesStateCheck(wallet)
      ? yield* finishFromRestore(
          ctx,
          wallet,
          parsed,
          isTokenSpent(wallet, parsed.mint, inputs),
          transfer,
          reason,
        )
      : null;
    return (
      restored ??
      (yield* swapAndKeep(ctx, wallet, scope, parsed, transfer, reason))
    );
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
    )(swapAndKeep(ctx, wallet, scope, parsed, null, reason)),
  );

/** cashu-ts sets no HTTP timeout; a mint that never answers is unreachable after this. */
const MINT_ANSWER_TIMEOUT = Duration.seconds(15);

const answerWithin =
  (mint: MintUrl, step: string) =>
  <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, E | MintUnreachable> =>
    Effect.timeoutFail(effect, {
      duration: MINT_ANSWER_TIMEOUT,
      onTimeout: () =>
        new MintUnreachable({ mint, detail: `${step} did not finish in time` }),
    });

const decodeAgainst = (
  wallet: LoadedWallet,
  tokenText: TokenText,
): DecodedToken | null =>
  decodeTokenText(
    tokenText,
    wallet.keyChain.getKeysets().map((keyset) => keyset.id),
  ) ?? decodeTokenText(tokenText);

/**
 * The token's proofs, its short v2 keyset ids (v4 text) expanded against the
 * mint's keysets, refreshed once when they do not resolve. Without its
 * proofs a receive could not ask the mint about them, so it writes nothing.
 * Ids that the refreshed keysets still do not resolve name no keyset of the
 * mint, so the token is undecodable for good.
 */
const decodeInputs = (
  wallet: LoadedWallet,
  parsed: ReceivableToken,
): Effect.Effect<
  DecodedToken,
  MintUnreachable | MintRejected | TokenParseFailed
> =>
  Effect.gen(function* () {
    const cached = decodeAgainst(wallet, parsed.tokenText);
    if (cached !== null) return cached;
    yield* Effect.tryPromise({
      try: () => wallet.loadMint(true),
      catch: (error) => classifyMintError(parsed.mint, error),
    }).pipe(answerWithin(parsed.mint, "refreshing the mint's keysets"));
    const refreshed = decodeAgainst(wallet, parsed.tokenText);
    if (refreshed !== null) return refreshed;
    return yield* new TokenParseFailed({
      reason: "undecodable",
      detail: "token proofs name no keyset of the mint",
    });
  });

/**
 * The mint's NUT-07 answer for every input, asked before a receive writes
 * anything. Null for a mint that does not advertise the check, which would
 * refuse every receive if its answer were required.
 */
const inputStates = (
  wallet: LoadedWallet,
  mint: MintUrl,
  decoded: DecodedToken,
): Effect.Effect<
  { readonly spent: ReadonlySet<string> } | null,
  MintUnreachable | MintRejected
> =>
  !advertisesStateCheck(wallet)
    ? Effect.succeed(null)
    : answeredStates(wallet, mint, decoded.proofs).pipe(
        answerWithin(mint, "the proof state check"),
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

const newTokenOperation = (
  kind: "receive" | "deferredReceive",
  parsed: ReceivableToken,
  createdAt: UnixSeconds,
): NewOperation =>
  new NewOperation({
    kind,
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

const insertNew = (
  ctx: ReceiveContext,
  kind: "receive" | "deferredReceive",
  parsed: ReceivableToken,
  reason: string,
): Effect.Effect<StoredOperation> =>
  Effect.flatMap(nowSeconds, (now) =>
    insertOperation(
      ctx,
      newTokenOperation(kind, parsed, UnixSeconds.make(now)),
      reason,
    ),
  );

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

/** A `deferredReceive` still waiting for its mint. */
export type DeferredOperation = StoredOperation & {
  readonly tokenText: TokenText;
};

export const isPendingDeferral = (
  operation: StoredOperation,
): operation is DeferredOperation =>
  operation.kind === "deferredReceive" &&
  operation.status === "pending" &&
  operation.tokenText !== null;

const DEFERRAL_REASON = "deferred-receive";

/**
 * Patches the deferral only while it is still `pending`, as stored now: a
 * deferral another pass or device closed stays as they left it.
 */
export const closeDeferral = (
  ctx: ReceiveContext,
  deferral: StoredOperation,
  patch: OperationPatch,
): Effect.Effect<void> =>
  Effect.flatMap(ctx.operationStore.loadAll, (operations) => {
    const current = operations.find(
      (operation) =>
        operation.id === deferral.id && isPendingDeferral(operation),
    );
    return current === undefined
      ? Effect.void
      : patchOperation(ctx, current, patch, DEFERRAL_REASON);
  });

/**
 * Where a received text comes from: pasted or carried by a message
 * (`fresh`), a transfer being taken back or retried (`replaced`), or a
 * deferral being retried (`deferred`), whose `recorded` turns true once its
 * receive is written.
 */
type Origin =
  | { readonly _tag: "fresh" }
  | { readonly _tag: "replaced"; readonly replaced: ReplacedTransfer }
  | {
      readonly _tag: "deferred";
      readonly deferral: DeferredOperation;
      readonly recorded: Ref.Ref<boolean>;
    };

const replacedOf = (origin: Origin): ReplacedTransfer | null =>
  origin._tag === "replaced" ? origin.replaced : null;

/**
 * Keeps a fresh token whose mint cannot be used under a `deferredReceive`,
 * whose id never matches the token's `receive`. Without the mint's keysets
 * dedup is by text and by the secrets of a token that decodes on its own. A
 * pending deferral of the text is reused; an unfinished receive of it fails
 * with the mint's error, left for its own resume.
 */
const deferReceive = (
  ctx: ReceiveContext,
  parsed: ReceivableToken,
  error: MintUnreachable | MintRejected,
): Effect.Effect<
  never,
  ReceiveDeferred | TokenAlreadyKnown | MintUnreachable | MintRejected
> =>
  Effect.gen(function* () {
    const operations = yield* ctx.operationStore.loadAll;
    if (findReopened(operations, parsed.tokenText, null) !== undefined) {
      return yield* Effect.fail(error);
    }
    const known = findKnown(
      operations,
      yield* ctx.proofStore.loadAll,
      parsed.tokenText,
      null,
      decodeTokenText(parsed.tokenText),
    );
    if (known !== null) return yield* known;
    const deferral =
      operations.find(
        (operation) =>
          isPendingDeferral(operation) &&
          operation.tokenText === parsed.tokenText,
      ) ?? (yield* insertNew(ctx, "deferredReceive", parsed, DEFERRAL_REASON));
    return yield* new ReceiveDeferred({
      mint: parsed.mint,
      operationId: deferral.id,
      amount: parsed.amount,
    });
  });

/**
 * What a mint that cannot be loaded, refreshed or asked means before
 * anything is written: a fresh token is deferred, a retried deferral stays
 * as it is, and a retried transfer fails with the mint's error.
 */
const whenMintUnusable =
  (ctx: ReceiveContext, parsed: ReceivableToken, origin: Origin) =>
  (
    error: MintUnreachable | MintRejected,
  ): Effect.Effect<
    never,
    ReceiveDeferred | TokenAlreadyKnown | MintUnreachable | MintRejected
  > => {
    switch (origin._tag) {
      case "fresh":
        return deferReceive(ctx, parsed, error);
      case "deferred":
        return new ReceiveDeferred({
          mint: parsed.mint,
          operationId: origin.deferral.id,
          amount: parsed.amount,
        });
      case "replaced":
        return Effect.fail(error);
    }
  };

/**
 * Timing out interrupts the load, which evicts it from `WalletInstances`, so
 * the next receive at the mint starts a fresh load.
 */
const loadReceivingWallet = (
  ctx: ReceiveContext,
  parsed: ReceivableToken,
): Effect.Effect<LoadedWallet, MintUnreachable | MintRejected> =>
  ctx.instances
    .get(parsed.mint, parsed.unit)
    .pipe(answerWithin(parsed.mint, "loading the mint"));

const receiptOf = (
  transfer: StoredOperation,
  parsed: ReceivableToken,
  accepted: AcceptedToken,
): ReceiveReceipt =>
  new ReceiveReceipt({
    operationId: transfer.id,
    tokenText: accepted.tokenText,
    mint: parsed.mint,
    unit: parsed.unit,
    amount: accepted.amount,
  });

/**
 * The unfinished receive this one continues, from freshly loaded rows, and
 * the proofs as stored now. Fails `TokenAlreadyKnown` when a transfer or a
 * stored proof already accounts for the text, or when another context
 * finished the replaced transfer or closed the retried deferral.
 */
const dedup = (
  ctx: ReceiveContext,
  parsed: ReceivableToken,
  decoded: DecodedToken,
  origin: Origin,
): Effect.Effect<
  {
    readonly reopened: StoredOperation | null;
    readonly proofs: ReadonlyArray<StoredProof>;
  },
  TokenAlreadyKnown
> =>
  Effect.gen(function* () {
    const operations = yield* ctx.operationStore.loadAll;
    const proofs = yield* ctx.proofStore.loadAll;
    if (
      origin._tag === "deferred" &&
      !operations.some(
        (operation) =>
          operation.id === origin.deferral.id && isPendingDeferral(operation),
      )
    ) {
      return yield* new TokenAlreadyKnown({
        operationId: origin.deferral.id,
      });
    }
    const replaced = replacedOf(origin);
    const reopened =
      findReopened(operations, parsed.tokenText, replaced) ?? null;
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
    return { reopened, proofs };
  });

/** A receive of the text now carries it: its pending deferral is `done`. */
const closeDeferralsOf = (
  ctx: ReceiveContext,
  tokenText: TokenText,
): Effect.Effect<void> =>
  Effect.flatMap(ctx.operationStore.loadAll, (operations) =>
    Effect.forEach(
      operations.filter(
        (operation) =>
          isPendingDeferral(operation) && operation.tokenText === tokenText,
      ),
      (deferral) =>
        patchOperation(ctx, deferral, { status: "done" }, DEFERRAL_REASON),
      { discard: true },
    ),
  );

/**
 * Writes the receive after a last dedup, since a receive of the text may
 * have synced in while the mint answered: inserts it, or reopens the
 * unfinished one, and hands the text's pending deferral over to it.
 */
const recordReceive = (
  ctx: ReceiveContext,
  parsed: ReceivableToken,
  decoded: DecodedToken,
  origin: Origin,
  reason: string,
): Effect.Effect<
  {
    readonly transfer: StoredOperation;
    readonly proofs: ReadonlyArray<StoredProof>;
  },
  TokenAlreadyKnown
> =>
  Effect.gen(function* () {
    const { reopened, proofs } = yield* dedup(ctx, parsed, decoded, origin);
    const transfer =
      reopened === null
        ? yield* insertNew(ctx, "receive", parsed, reason)
        : yield* reopen(ctx, reopened, reason);
    yield* closeDeferralsOf(ctx, parsed.tokenText);
    if (origin._tag === "deferred") yield* Ref.set(origin.recorded, true);
    return { transfer, proofs };
  });

const RECEIVE_LOCK_KEY_PREFIX = "linkshu.receiveLock.";

/**
 * Cross-context turns over a mint's receives. The counter lock alone would
 * not do: wallets loaded before and after a keyset rotation bind different
 * keysets, so two contexts would take different counter locks for one
 * token. Taken before the counter lock, never while holding one. Waiting
 * longer than 30 s fails with `CounterLockTimeout`, its `keysetId` null.
 */
export const withReceiveLock =
  (
    kv: KeyValueStoreService,
    { mint, unit }: { readonly mint: MintUrl; readonly unit: CurrencyUnit },
  ) =>
  <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | CounterLockTimeout, R> =>
    withKeyLease(kv, RECEIVE_LOCK_KEY_PREFIX + encodeURIComponent(mint), {
      acquireTimeoutMs: 30_000,
      // Slower polling than the counter lock bounds a 30 s wait at 60 store calls.
      pollMs: 500,
    })(effect).pipe(
      Effect.catchTag(
        "LeaseLockTimeout",
        () => new CounterLockTimeout({ mint, unit, keysetId: null }),
      ),
    );

/**
 * Receiving a token is one call: extract and decode the text, dedup against
 * stored transfers and proofs, ask the mint whether the proofs are spent,
 * persist a `pending` receive, re-sign the proofs at the mint with
 * deterministic outputs (recovering counter collisions via targeted NUT-09
 * lookups), store them as `available`, and close the receive as `done` — or
 * `failed`, carrying the serialized error, so that pasting the text again
 * retries it.
 *
 * Everything after parsing runs under the mint's receive lock, so two
 * contexts receiving one token see each other's outcome whatever keyset
 * their wallets bind, and a mint's deferrals are read and written in turn;
 * dedup, writes and the swap run under the counter lock as well. Each swap
 * attempt persists its output slot on the transfer before it reaches the
 * mint: receiving the text of an unfinished receive resumes it, taking the
 * outputs from NUT-09 when the mint already signed them.
 *
 * A receive's id derives from its token text, so a device that has not
 * synced another device's `done` receive of the token would write over it.
 * Nothing is written until the mint has answered for every input: a spent
 * token fails `TokenAlreadySpent` unless the receive's own recorded attempt
 * spent it, a mint that cannot be loaded, refreshed or asked defers a fresh
 * token and leaves anything retried as it stood, and a token whose proofs
 * name no keyset of the mint fails `TokenParseFailed`. Writing the receive closes the text's pending deferral.
 *
 * Re-receiving (`replaced`) follows the same path over the replaced transfer
 * instead of a fresh one: a failed `receive` is retried in place; a `send`'s
 * handed-out proofs, ours to take back without asking, are marked `spent`
 * and the send `returned` only once the fresh proofs are stored, so funds are
 * never outside the store.
 */
const receiveParsed = (
  ctx: ReceiveContext,
  parsed: ReceivableToken,
  origin: Origin,
): Effect.Effect<ReceiveReceipt, ReceiveError> =>
  Effect.gen(function* () {
    const replaced = replacedOf(origin);
    const reason = replaced?.reason ?? "receive";
    const unusable = whenMintUnusable(ctx, parsed, origin);
    // The mint's keysets decide dedup (short v2 ids in v4 text) and the fee,
    // so a mint that will not load ends the receive before the swap.
    const wallet = yield* loadReceivingWallet(ctx, parsed).pipe(
      Effect.catchAll(unusable),
    );
    const decoded = yield* decodeInputs(wallet, parsed).pipe(
      Effect.catchTags({ MintUnreachable: unusable, MintRejected: unusable }),
    );
    const scope = yield* counterScopeFor(wallet, parsed).pipe(
      Effect.catchAll(unusable),
    );
    return yield* withCounterLock(
      ctx.kv,
      scope,
    )(
      Effect.gen(function* () {
        yield* dedup(ctx, parsed, decoded, origin);
        // A swap signs what is left after the mint's input fee. A token worth
        // no more than that fee has nothing to sign, and no wallet can redeem
        // it on its own, so it is refused before anything is recorded.
        const fee = inputFeeForProofs(wallet, decoded.proofs);
        if (parsed.amount <= fee) {
          return yield* new AmountConsumedByFee({
            mint: parsed.mint,
            amount: parsed.amount,
            fee: Amount.make(fee),
          });
        }
        const states =
          replaced?.operation.kind === "send"
            ? null
            : yield* inputStates(wallet, parsed.mint, decoded).pipe(
                Effect.catchAll(unusable),
              );
        if (states !== null && states.spent.size > 0) {
          // While the mint answered, a receive of this text may have synced in.
          const { reopened } = yield* dedup(ctx, parsed, decoded, origin);
          const finished = yield* finishFromRestore(
            ctx,
            wallet,
            parsed,
            Effect.succeed(states.spent.size === decoded.proofs.length),
            reopened,
            reason,
          );
          if (finished === null || reopened === null) {
            return yield* new TokenAlreadySpent({ mint: parsed.mint });
          }
          yield* patchOperation(
            ctx,
            reopened,
            { status: "done", error: null },
            reason,
          );
          yield* closeDeferralsOf(ctx, parsed.tokenText);
          return receiptOf(reopened, parsed, finished);
        }

        const { transfer, proofs } = yield* recordReceive(
          ctx,
          parsed,
          decoded,
          origin,
          reason,
        );

        const accepted = yield* Effect.either(
          states === null
            ? acceptUnchecked(
                ctx,
                wallet,
                scope,
                parsed,
                decoded.proofs,
                transfer,
                reason,
              )
            : // Unspent at the mint, so no earlier attempt of this receive reached it.
              swapAndKeep(ctx, wallet, scope, parsed, transfer, reason),
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
        return receiptOf(transfer, parsed, accepted.right);
      }),
    );
  });

const receiveFrom = (
  ctx: ReceiveContext,
  text: string,
  origin: Origin,
): Effect.Effect<ReceiveReceipt, ReceiveError> =>
  Effect.flatMap(parseReceivable(text), (parsed) =>
    receiveParsed(ctx, parsed, origin).pipe(withReceiveLock(ctx.kv, parsed)),
  );

/** Receives pasted or message-borne text, or takes back `replaced`. */
export const receiveTokenText = (
  ctx: ReceiveContext,
  text: string,
  replaced: ReplacedTransfer | null,
): Effect.Effect<ReceiveReceipt, ReceiveError> =>
  receiveFrom(
    ctx,
    text,
    replaced === null ? { _tag: "fresh" } : { _tag: "replaced", replaced },
  );

/**
 * Receives a pending deferral's text; `recorded` turns true once its
 * `receive` is written and the deferral handed over to it. Writes nothing
 * while the mint still cannot be used, and never inserts or reopens the
 * deferral.
 */
export const receiveDeferred = (
  ctx: ReceiveContext,
  deferral: DeferredOperation,
  recorded: Ref.Ref<boolean>,
): Effect.Effect<ReceiveReceipt, ReceiveError> =>
  receiveFrom(ctx, deferral.tokenText, {
    _tag: "deferred",
    deferral,
    recorded,
  });
