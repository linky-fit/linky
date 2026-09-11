import type { Proof as CashuProof } from "@cashu/cashu-ts";
import { Effect, Either, Schema } from "effect";
import {
  MintRejected,
  TokenAlreadyKnown,
  TokenAlreadySpent,
  TokenParseFailed,
} from "../../domain/errors";
import type { CounterLockTimeout, MintUnreachable } from "../../domain/errors";
import { CurrencyUnit, UnixSeconds } from "../../domain/primitives";
import { sat } from "../../internal/units";
import type { Amount, MintUrl, TokenText } from "../../domain/primitives";
import type { InspectorService } from "../../inspector/Inspector";
import { recoverFromCollision } from "../../internal/collisionRecovery";
import {
  advanceCounterTo,
  readCounter,
  withCounterLock,
} from "../../internal/counters";
import type { CounterScope } from "../../internal/counters";
import { insertOperation, patchOperation } from "../../internal/operations";
import {
  isRecoverableOutputCollision,
  isTokenAlreadySpentError,
} from "../../internal/outputCollisions";
import {
  insertProofs,
  setProofState,
  toNewProofs,
} from "../../internal/proofs";
import { nowSeconds } from "../../internal/time";
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
import { encodeCashuProofs } from "../../token/internal/cashuProofs";
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

/** Re-signs the token at the mint and stores the fresh proofs as balance. */
const acceptAtMint = (
  ctx: ReceiveContext,
  wallet: LoadedWallet,
  parsed: ReceivableToken,
  reason: string,
): Effect.Effect<
  { readonly tokenText: TokenText; readonly amount: Amount },
  AcceptFailure
> =>
  Effect.gen(function* () {
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
    const fresh = toNewProofs(
      proofs,
      parsed.mint,
      parsed.unit,
      "available",
      null,
    );
    if (encoded === null || fresh === null) {
      return yield* new MintRejected({
        mint: parsed.mint,
        code: null,
        detail: "mint returned malformed proofs from the swap",
      });
    }
    yield* insertProofs(ctx, fresh, reason);
    return { tokenText: encoded.tokenText, amount: encoded.amount };
  });

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
  /** The mint's keyset ids, so v4 text with short v2 ids decodes too. */
  keysetIds: readonly string[],
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
  const decoded =
    decodeTokenText(tokenText, keysetIds) ?? decodeTokenText(tokenText);
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
 * Receiving a token is one call: extract and decode the text, dedup against
 * stored transfers and proofs, persist a `pending` receive, re-sign the
 * proofs at the mint with deterministic outputs (recovering counter
 * collisions via targeted NUT-09 lookups), store them as `available`, and
 * close the receive as `done` — or `failed`, carrying the serialized error,
 * so that pasting the text again retries it.
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
    // The mint's keysets decide dedup (short v2 ids in v4 text), so a mint
    // that will not load ends the receive before anything is recorded.
    const wallet = yield* ctx.instances.get(parsed.mint, parsed.unit);
    const operations = yield* ctx.operationStore.loadAll;
    const proofs = yield* ctx.proofStore.loadAll;
    const known = findKnown(
      operations,
      proofs,
      parsed.tokenText,
      replaced?.operation ?? null,
      wallet.keyChain.getKeysets().map((keyset) => keyset.id),
    );
    if (known !== null) return yield* known;

    const transfer =
      replaced === null
        ? yield* insertOperation(
            ctx,
            pendingReceive(parsed, UnixSeconds.make(yield* nowSeconds)),
            reason,
          )
        : yield* reopen(ctx, replaced.operation, reason);

    const accepted = yield* Effect.either(
      acceptAtMint(ctx, wallet, parsed, reason),
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
      yield* setProofState(ctx, proofsOf(proofs, transfer), "spent", reason);
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
  });
