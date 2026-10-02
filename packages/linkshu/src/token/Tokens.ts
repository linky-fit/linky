import { Effect, Schema } from "effect";
import { decodeTokenText, parseTokenText } from "./codec";
import {
  InvalidTransferTransition,
  MintBalance,
  TokenTransfer,
  WalletBalances,
} from "./domain";
import type { ImportProofDraft, LegacyTokenRow } from "./domain";
import { OperationNotFound, TokenParseFailed } from "../domain/errors";
import type { CounterLockTimeout } from "../domain/errors";
import { Amount, NonNegativeAmount } from "../domain/primitives";
import type { MintUrl, OperationId } from "../domain/primitives";
import { Inspector } from "../inspector/Inspector";
import {
  insertOperation,
  inspectOperation,
  inspectOperationWith,
  patchOperation,
  redactReceipt,
} from "../internal/operations";
import {
  domainToNewProofs,
  insertProofs,
  setProofState,
  storedSecrets,
  totalAmount,
} from "../internal/proofs";
import { sat } from "../internal/units";
import { meltRecords } from "../melt/internal/meltRecords";
import { WalletInstances } from "../mint/internal/WalletInstances";
import { KeyValueStore } from "../ports/KeyValueStore";
import { NewOperation, OperationStore } from "../ports/OperationStore";
import type { OperationStatus, StoredOperation } from "../ports/OperationStore";
import { NewProof, ProofStore } from "../ports/ProofStore";
import type { ProofState, StoredProof } from "../ports/ProofStore";
import { ReceiveReceipt } from "../receive/domain";
import type { ReceiveError } from "../receive/domain";
import {
  parseReceivable,
  receiveReplaced,
  withReceiveLock,
} from "../receive/internal/acceptFlow";
import type { ReceiveContext } from "../receive/internal/acceptFlow";
import type { DecodedToken } from "./domain";
import type { ProofId } from "../domain/primitives";
import { reclaimProofs } from "./internal/reclaim";

export class LegacyIngestReport extends Schema.Class<LegacyIngestReport>(
  "LegacyIngestReport",
)({
  /** Rows whose proofs were not yet in the inventory and are now. */
  ingestedRows: Schema.Int,
  proofs: Schema.Int,
}) {}

const isTransfer = (operation: StoredOperation): boolean =>
  operation.kind === "send" || operation.kind === "receive";

const isForgettable = (operation: StoredOperation): boolean =>
  isTransfer(operation) || operation.kind === "deferredReceive";

/** Statuses `forget` closes, per kind. */
const forgettableFrom = (operation: StoredOperation): ReadonlyArray<string> => {
  switch (operation.kind) {
    case "send":
      return ["issued", "pending", "externalized"];
    case "receive":
      return ["pending", "failed"];
    default:
      return ["pending"];
  }
};

const toTransfer = (operation: StoredOperation): TokenTransfer | null => {
  if (
    (operation.kind !== "send" && operation.kind !== "receive") ||
    operation.tokenText === null
  )
    return null;
  return new TokenTransfer({
    id: operation.id,
    kind: operation.kind,
    status: operation.status,
    tokenText: operation.tokenText,
    mint: operation.mint,
    unit: operation.unit,
    amount: operation.amount,
    error: operation.error,
    createdAt: operation.createdAt,
  });
};

const isTokenAlreadySpentError = (error: string | null): boolean => {
  if (error === null) return false;
  try {
    const parsed: unknown = JSON.parse(error);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      Reflect.get(parsed, "_tag") === "TokenAlreadySpent"
    );
  } catch {
    return false;
  }
};

/**
 * Read model over the inventory plus the transfer transitions callers are
 * allowed to make. Every state change outside the operation verticals goes
 * through here — platforms never write states themselves.
 */
export class Tokens extends Effect.Service<Tokens>()("linkshu/Tokens", {
  dependencies: [WalletInstances.Default],
  effect: Effect.gen(function* () {
    const kv = yield* KeyValueStore;
    const proofStore = yield* ProofStore;
    const operationStore = yield* OperationStore;
    const instances = yield* WalletInstances;
    const inspector = yield* Inspector.orNoop;
    const ctx = { proofStore, operationStore, inspector };
    const receiveContext: ReceiveContext = { ...ctx, kv, instances };
    const melts = meltRecords({ kv, operationStore, inspector });
    const reclaim = (ids: ReadonlyArray<ProofId>) =>
      reclaimProofs(receiveContext, ids);

    const newestFirst = <T extends { readonly createdAt: number }>(
      rows: ReadonlyArray<T>,
    ): ReadonlyArray<T> => [...rows].sort((a, b) => b.createdAt - a.createdAt);

    /** The whole inventory, any state, newest first. */
    const proofs: Effect.Effect<ReadonlyArray<StoredProof>> = Effect.map(
      proofStore.loadAll,
      newestFirst,
    );

    /** Every stored operation, newest first. */
    const operations: Effect.Effect<ReadonlyArray<StoredOperation>> =
      Effect.map(operationStore.loadAll, newestFirst);

    /** Tokens that crossed the wallet boundary as text, newest first. */
    const transfers: Effect.Effect<ReadonlyArray<TokenTransfer>> = Effect.map(
      operations,
      (rows) =>
        rows.flatMap((operation) => {
          const transfer = toTransfer(operation);
          return transfer === null ? [] : [transfer];
        }),
    );

    const balances: Effect.Effect<WalletBalances> = Effect.map(
      proofStore.loadAll,
      (rows) => {
        const perMint = new Map<MintUrl, number>();
        for (const proof of rows) {
          if (proof.state !== "available") continue;
          perMint.set(
            proof.mint,
            (perMint.get(proof.mint) ?? 0) + proof.amount,
          );
        }
        const amounts = [...perMint.values()];
        return new WalletBalances({
          total: NonNegativeAmount.make(amounts.reduce((a, b) => a + b, 0)),
          spendable: NonNegativeAmount.make(Math.max(0, ...amounts)),
          perMint: [...perMint].map(
            ([mint, amount]) =>
              new MintBalance({ mint, amount: NonNegativeAmount.make(amount) }),
          ),
        });
      },
    );

    const requireTransfer = (
      operationId: OperationId,
      accepts: (operation: StoredOperation) => boolean = isTransfer,
    ): Effect.Effect<StoredOperation, OperationNotFound> =>
      Effect.flatMap(operationStore.loadAll, (rows) => {
        const operation = rows.find(
          (candidate) => candidate.id === operationId && accepts(candidate),
        );
        return operation === undefined
          ? Effect.fail(new OperationNotFound({ operationId }))
          : Effect.succeed(operation);
      });

    const proofsOf = (
      operation: StoredOperation,
    ): Effect.Effect<ReadonlyArray<StoredProof>> =>
      Effect.map(proofStore.loadAll, (rows) =>
        rows.filter((proof) => proof.operationId === operation.id),
      );

    /**
     * One transition of a `send` transfer: the status moves when legal, and
     * its handed-out proofs follow when `proofState` is given.
     */
    const transitionSend = (
      operationId: OperationId,
      from: ReadonlyArray<OperationStatus>,
      to: OperationStatus,
      operation: string,
      proofState?: ProofState,
    ): Effect.Effect<void, OperationNotFound | InvalidTransferTransition> =>
      Effect.gen(function* () {
        const transfer = yield* requireTransfer(operationId);
        if (transfer.kind !== "send" || !from.includes(transfer.status)) {
          return yield* new InvalidTransferTransition({
            operationId,
            from: transfer.status,
            to,
          });
        }
        if (proofState !== undefined) {
          const held = (yield* proofsOf(transfer)).filter(
            (proof) => proof.state !== "spent",
          );
          yield* setProofState(ctx, held, proofState, operation);
        }
        yield* patchOperation(ctx, transfer, { status: to }, operation);
      }).pipe(
        inspectOperation(inspector, `tokens.${operation}`, { operationId }),
      );

    /** `pending` → `issued`: a messenger token was shown as a QR after all. */
    const markIssued = (operationId: OperationId) =>
      transitionSend(operationId, ["pending"], "issued", "markIssued");

    /** `issued` | `pending` → `externalized`: the token left the app entirely. */
    const markExternalized = (operationId: OperationId) =>
      transitionSend(
        operationId,
        ["issued", "pending"],
        "externalized",
        "markExternalized",
        "externalized",
      );

    const close = (
      operation: StoredOperation,
    ): Effect.Effect<void, InvalidTransferTransition> =>
      forgettableFrom(operation).includes(operation.status)
        ? patchOperation(ctx, operation, { status: "done" }, "forget")
        : new InvalidTransferTransition({
            operationId: operation.id,
            from: operation.status,
            to: "done",
          });

    /**
     * Closes a transfer the caller has nothing left to do about: a `send`
     * whose token verifiably reached its recipient, a `receive` that failed
     * for good, or a pending `deferredReceive` the user gives up on. Not a
     * refund — handed-out proofs stay handed out and are still reported
     * spent once the recipient claims them, and a discarded deferral's token
     * is gone unless its text is kept elsewhere.
     */
    const forget = (
      operationId: OperationId,
    ): Effect.Effect<
      void,
      OperationNotFound | InvalidTransferTransition | CounterLockTimeout
    > =>
      Effect.flatMap(
        requireTransfer(operationId, isForgettable),
        (operation) =>
          operation.kind === "deferredReceive"
            ? // Reread under the lease: a receive may have taken it over since.
              Effect.flatMap(
                requireTransfer(operationId, isForgettable),
                close,
              ).pipe(withReceiveLock(kv, operation))
            : close(operation),
      ).pipe(inspectOperation(inspector, "tokens.forget", { operationId }));

    /**
     * Bring a transfer's funds back: a handed-out `send` is re-received so
     * the encoding somebody else may hold dies at the mint; a failed or
     * interrupted `receive` is retried. See `receiveReplaced`.
     */
    const returnToWallet = (
      operationId: OperationId,
    ): Effect.Effect<
      ReceiveReceipt,
      ReceiveError | OperationNotFound | InvalidTransferTransition
    > =>
      Effect.gen(function* () {
        const transfer = yield* requireTransfer(operationId);
        const returnable =
          transfer.kind === "send"
            ? ["issued", "pending", "externalized"]
            : ["pending", "failed"];
        if (
          !returnable.includes(transfer.status) ||
          transfer.tokenText === null
        ) {
          return yield* new InvalidTransferTransition({
            operationId,
            from: transfer.status,
            to: transfer.kind === "send" ? "returned" : "done",
          });
        }
        return yield* receiveReplaced(receiveContext, transfer.tokenText, {
          operation: transfer,
          reason: "returnToWallet",
        });
      }).pipe(
        inspectOperationWith(
          inspector,
          "tokens.returnToWallet",
          { operationId },
          redactReceipt,
        ),
      );

    /**
     * Restores proofs from a backup exactly as it states them. Secrets the
     * inventory already holds are skipped, so a backup imported twice adds
     * nothing. Returns how many proofs were added.
     */
    const importProofs = (
      drafts: ReadonlyArray<ImportProofDraft>,
    ): Effect.Effect<number> =>
      Effect.gen(function* () {
        const known = storedSecrets(yield* proofStore.loadAll);
        const fresh = drafts
          .filter((draft) => !known.has(draft.secret))
          .map((draft) => new NewProof({ ...draft }));
        yield* insertProofs(ctx, fresh, "import");
        return fresh.length;
      }).pipe(
        inspectOperation(inspector, "tokens.importProofs", {
          count: drafts.length,
        }),
      );

    /** Restores an operation from a backup; an existing one is replaced. */
    const importOperation = (draft: NewOperation): Effect.Effect<OperationId> =>
      Effect.map(
        insertOperation(ctx, draft, "import"),
        (stored) => stored.id,
      ).pipe(
        inspectOperation(inspector, "tokens.importOperation", {
          kind: draft.kind,
        }),
      );

    /** Decodes stored token text, loading the mint's keysets only when needed. */
    const decodeStored = (text: string): Effect.Effect<DecodedToken | null> =>
      Effect.gen(function* () {
        const decoded = decodeTokenText(text);
        if (decoded !== null) return decoded;
        const parsed = parseTokenText(text);
        if (parsed === null || parsed.mint === null) return null;
        const wallet = yield* Effect.option(
          instances.get(parsed.mint, parsed.unit ?? sat),
        );
        if (wallet._tag === "None") return null;
        return decodeTokenText(
          text,
          wallet.value.keyChain.getKeysets().map((keyset) => keyset.id),
        );
      });

    /**
     * Stores a token's proofs as `available` without re-signing them at the
     * mint. Only for a wallet that exists to spend one token it already
     * trusts (the site's redemption page); anything received from someone
     * else goes through `Receive`, or the sender keeps a spendable copy.
     * Secrets already stored are skipped. Returns the amount added.
     */
    const adoptToken = (
      text: string,
    ): Effect.Effect<NonNegativeAmount, TokenParseFailed> =>
      Effect.gen(function* () {
        const parsed = yield* parseReceivable(text);
        const decoded = yield* decodeStored(parsed.tokenText);
        if (decoded === null) {
          return yield* new TokenParseFailed({
            reason: "undecodable",
            detail: "token proofs could not be decoded",
          });
        }
        const known = storedSecrets(yield* proofStore.loadAll);
        const fresh = decoded.proofs.filter(
          (proof) => !known.has(proof.secret),
        );
        yield* insertProofs(
          ctx,
          domainToNewProofs(
            fresh,
            decoded.mint,
            decoded.unit,
            "available",
            null,
          ),
          "adopt",
        );
        return NonNegativeAmount.make(totalAmount(fresh));
      }).pipe(
        // Params stay empty: the only input is token text (proof secrets).
        inspectOperation(inspector, "tokens.adoptToken", {}),
      );

    /**
     * Carries rows of the previous storage model into the inventory. A row
     * is ingested when any of its proofs is not yet stored; `pending` rows
     * are skipped, `accepted` becomes `available`, `reserved` is `held` by
     * the pending melt already holding part of the row, else by the one
     * whose inputs sum to the row (`available` when no melt matches),
     * `issued`/`externalized` become a `send` transfer with
     * handed-out proofs, and `error` is `spent` only when the recorded error
     * says so — everything else is `available` for the next mint check to
     * decide. A `reserved` row's proofs that older releases stored `held` by
     * no operation are sorted the same way. Never drops funds; safe to run
     * on every load and on every device, because ids derive from secrets.
     */
    const ingestLegacyRows = (
      rows: ReadonlyArray<LegacyTokenRow>,
    ): Effect.Effect<LegacyIngestReport> =>
      Effect.gen(function* () {
        const stored = yield* proofStore.loadAll;
        const known = storedSecrets(stored);
        const heldByNone = new Map(
          stored
            .filter(
              (proof) => proof.state === "held" && proof.operationId === null,
            )
            .map((proof) => [proof.secret, proof]),
        );
        const pendingMelts = yield* melts.readAll;
        const holderOf = new Map(
          stored
            .filter((proof) => proof.state === "held")
            .map((proof) => [proof.secret, proof.operationId]),
        );
        const linkedMelts = new Set(holderOf.values());
        let ingestedRows = 0;
        let proofCount = 0;
        for (const row of rows) {
          if (row.state === "pending") continue;
          const decoded = yield* decodeStored(row.tokenText);
          if (decoded === null) continue;
          const fresh = decoded.proofs.filter(
            (proof) => !known.has(proof.secret),
          );
          const stranded =
            row.state === "reserved"
              ? decoded.proofs.flatMap(
                  (proof) => heldByNone.get(proof.secret) ?? [],
                )
              : [];
          if (fresh.length === 0 && stranded.length === 0) continue;
          for (const proof of fresh) known.add(proof.secret);
          for (const proof of stranded) heldByNone.delete(proof.secret);

          let state: ProofState = "available";
          let operationId: OperationId | null = null;
          if (row.state === "reserved") {
            const total = totalAmount(decoded.proofs);
            const rowHolders = new Set(
              decoded.proofs.map((proof) => holderOf.get(proof.secret)),
            );
            const melt =
              pendingMelts.find((candidate) => rowHolders.has(candidate.id)) ??
              pendingMelts.find(
                (candidate) =>
                  candidate.mint === decoded.mint &&
                  candidate.inputsTotal === total &&
                  !linkedMelts.has(candidate.id),
              );
            if (melt !== undefined) {
              state = "held";
              operationId = melt.id;
              linkedMelts.add(melt.id);
            }
          } else if (row.state === "issued" || row.state === "externalized") {
            state = row.state === "issued" ? "handedOut" : "externalized";
            const transfer = yield* insertOperation(
              ctx,
              new NewOperation({
                kind: "send",
                status: row.state,
                mint: decoded.mint,
                unit: decoded.unit,
                keysetId: null,
                amount: Amount.make(totalAmount(decoded.proofs)),
                feeReserve: null,
                inputsTotal: null,
                quoteId: null,
                invoice: null,
                sourceMint: null,
                counter: null,
                locked: null,
                expiresAt: null,
                createdAt: row.createdAt,
                tokenText: row.tokenText,
                error: null,
              }),
              "legacy-ingest",
            );
            operationId = transfer.id;
          } else if (
            row.state === "error" &&
            isTokenAlreadySpentError(row.error)
          ) {
            state = "spent";
          }
          yield* insertProofs(
            ctx,
            domainToNewProofs(
              fresh,
              decoded.mint,
              decoded.unit,
              state,
              operationId,
            ),
            "legacy-ingest",
          );
          yield* setProofState(
            ctx,
            stranded,
            state,
            "legacy-ingest",
            operationId,
          );
          ingestedRows += fresh.length > 0 ? 1 : 0;
          proofCount += fresh.length;
        }
        return new LegacyIngestReport({ ingestedRows, proofs: proofCount });
      }).pipe(
        inspectOperation(inspector, "tokens.ingestLegacyRows", {
          rows: rows.length,
        }),
      );

    return {
      proofs,
      operations,
      transfers,
      balances,
      markIssued,
      markExternalized,
      forget,
      returnToWallet,
      reclaim,
      importProofs,
      importOperation,
      adoptToken,
      ingestLegacyRows,
    } as const;
  }),
}) {}
