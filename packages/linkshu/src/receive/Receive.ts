import { Context, Effect, Layer, Ref, Result, Schema } from "effect";
import type { MintUrl } from "../domain/primitives";
import { Inspector } from "../inspector/Inspector";
import { inspectOperationWith, redactReceipt } from "../internal/operations";
import { WalletInstances } from "../mint/internal/WalletInstances";
import { KeyValueStore } from "../ports/KeyValueStore";
import { OperationStore } from "../ports/OperationStore";
import type { OperationPatch } from "../ports/OperationStore";
import { ProofStore } from "../ports/ProofStore";
import { DeferredReceiveResult, ReceiveError } from "./domain";
import type {
  ReceiveDraft,
  ReceiveReceipt,
  ReceiveUnlockOptions,
} from "./domain";
import {
  closeDeferral,
  isPendingDeferral,
  receiveDeferred,
  receiveDraft,
} from "./internal/acceptFlow";
import type { DeferredOperation, ReceiveContext } from "./internal/acceptFlow";

const encodeStoredError = Schema.encodeSync(
  Schema.fromJsonString(ReceiveError),
);

const deferredResult = (
  deferred: DeferredOperation,
  status: DeferredReceiveResult["status"],
  receipt: ReceiveReceipt | null = null,
) =>
  new DeferredReceiveResult({
    operationId: deferred.id,
    mint: deferred.mint,
    unit: deferred.unit,
    amount: deferred.amount,
    status,
    receipt,
  });

const redactDeferredResult = (result: DeferredReceiveResult) => ({
  ...result,
  receipt: result.receipt === null ? null : redactReceipt(result.receipt),
});

/**
 * Receiving a token is one call over the shared accept flow (see
 * `internal/acceptFlow.ts`, which `Tokens.returnToWallet` re-receives
 * through): extraction, decoding, dedup by token text and proof secret,
 * deterministic re-signing with counter-collision recovery, and transfer
 * bookkeeping.
 */
export class Receive extends Context.Service<Receive>()("linkshu/Receive", {
  make: Effect.gen(function* () {
    const ctx: ReceiveContext = {
      kv: yield* KeyValueStore,
      proofStore: yield* ProofStore,
      operationStore: yield* OperationStore,
      instances: yield* WalletInstances,
      inspector: yield* Inspector.orNoop,
    };
    const keyed = (options: ReceiveUnlockOptions): ReceiveContext => ({
      ...ctx,
      unlockingKey: options.unlockingKey ?? null,
    });

    const receive = (
      draft: ReceiveDraft,
      options: ReceiveUnlockOptions = {},
    ): Effect.Effect<ReceiveReceipt, ReceiveError> =>
      receiveDraft(keyed(options), draft).pipe(
        // Params stay empty: the only input is token text (proof secrets).
        inspectOperationWith(
          ctx.inspector,
          "receive.receive",
          {},
          redactReceipt,
        ),
      );

    const closeAs = (
      deferred: DeferredOperation,
      patch: OperationPatch,
    ): Effect.Effect<DeferredReceiveResult> =>
      closeDeferral(ctx, deferred, patch).pipe(
        Effect.as(deferredResult(deferred, "closed")),
        // Another context holds the mint's receive lease; a later pass closes it.
        Effect.catchTag("CounterLockTimeout", () =>
          Effect.succeed(deferredResult(deferred, "pending")),
        ),
      );

    const resumeOne = (
      keyedCtx: ReceiveContext,
      deferred: DeferredOperation,
    ): Effect.Effect<DeferredReceiveResult> =>
      Effect.gen(function* () {
        const recorded = yield* Ref.make(false);
        const outcome = yield* Effect.result(
          receiveDeferred(keyedCtx, deferred, recorded).pipe(
            Effect.map((receipt) =>
              deferredResult(deferred, "received", receipt),
            ),
            // A mint still unusable is the expected wait, not a failure.
            Effect.catchTag("ReceiveDeferred", () =>
              Effect.succeed(deferredResult(deferred, "pending")),
            ),
            inspectOperationWith(
              ctx.inspector,
              "receive.resume",
              { mint: deferred.mint, operationId: deferred.id },
              redactDeferredResult,
            ),
          ),
        );
        if (Result.isSuccess(outcome)) return outcome.success;
        if (yield* Ref.get(recorded)) return deferredResult(deferred, "failed");
        const error = outcome.failure;
        switch (error._tag) {
          case "TokenAlreadyKnown":
            return yield* closeAs(deferred, { status: "done" });
          case "TokenAlreadySpent":
          case "AmountConsumedByFee":
          case "TokenParseFailed":
            return yield* closeAs(deferred, {
              status: "failed",
              error: encodeStoredError(error),
            });
          case "MintUnreachable":
          case "MintRejected":
          case "CounterLockTimeout":
          case "TokenLocked": // only a pass or receive with its key finishes it
            return deferredResult(deferred, "pending");
        }
      });

    /**
     * Retries every pending `deferredReceive`. A mint still unusable keeps
     * the rest of its deferrals for the next pass instead of waiting out its
     * timeout once per token.
     */
    const resumeDeferred = (
      options: ReceiveUnlockOptions = {},
    ): Effect.Effect<ReadonlyArray<DeferredReceiveResult>> =>
      Effect.gen(function* () {
        const keyedCtx = keyed(options);
        const deferrals = (yield* ctx.operationStore.loadAll).filter(
          isPendingDeferral,
        );
        const unusable = new Set<MintUrl>();
        const results: DeferredReceiveResult[] = [];
        for (const deferred of deferrals) {
          const result = unusable.has(deferred.mint)
            ? deferredResult(deferred, "pending")
            : yield* resumeOne(keyedCtx, deferred);
          if (result.status === "pending") unusable.add(deferred.mint);
          results.push(result);
        }
        return results;
      }).pipe(
        inspectOperationWith(
          ctx.inspector,
          "receive.resumeDeferred",
          {},
          (results) => results.map(redactDeferredResult),
        ),
      );

    return { receive, resumeDeferred } as const;
  }),
}) {
  static readonly layerWithoutDependencies = Layer.effect(this, this.make);
  static readonly layer = this.layerWithoutDependencies.pipe(
    Layer.provide(WalletInstances.layer),
  );
}
