import { Effect, Struct } from "effect";
import type { TokenText } from "../domain/primitives";
import type { Proof } from "../token/domain";
import {
  OperationChanged,
  OperationFailed,
  OperationSucceeded,
} from "../inspector/events";
import type { InspectorService } from "../inspector/Inspector";
import type {
  NewOperation,
  OperationPatch,
  OperationStoreService,
  StoredOperation,
} from "../ports/OperationStore";

/**
 * Taps a wallet operation into the inspector: success as
 * `OperationSucceeded` (`redactResult` decides what of the result travels —
 * events must never carry proof secrets), failure as `OperationFailed`.
 * Never alters the operation's outcome.
 */
export const inspectOperationWith =
  <A>(
    inspector: InspectorService,
    name: string,
    params: unknown,
    redactResult: (result: A) => unknown,
  ) =>
  <E, R>(operation: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    operation.pipe(
      Effect.tap((result) =>
        Effect.sync(() =>
          inspector.emit(
            () =>
              new OperationSucceeded(
                { name, params, result: redactResult(result) },
                { disableValidation: true },
              ),
          ),
        ),
      ),
      inspectFailureWith(inspector, name, params),
    );

/** The failure half of `inspectOperationWith`, for attempts that are retried. */
export const inspectFailureWith =
  (inspector: InspectorService, name: string, params: unknown) =>
  <A, E, R>(operation: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.tapError(operation, (error) =>
      Effect.sync(() =>
        inspector.emit(
          () =>
            new OperationFailed(
              { name, params, error },
              { disableValidation: true },
            ),
        ),
      ),
    );

/** `inspectOperationWith` emitting the operation's result as-is. */
export const inspectOperation =
  (inspector: InspectorService, name: string, params: unknown) =>
  <A, E, R>(operation: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    inspectOperationWith<A>(
      inspector,
      name,
      params,
      (result) => result,
    )(operation);

/** Token text and proofs carry secrets; a receipt's other fields are safe. */
export const redactReceipt = <
  R extends {
    readonly tokenText: TokenText;
    readonly proofs?: ReadonlyArray<Proof>;
  },
>(
  receipt: R,
) => Struct.omit(receipt, "tokenText", "proofs");

export interface OperationContext {
  readonly operationStore: OperationStoreService;
  readonly inspector: InspectorService;
}

/** Persists an operation and reports it; the store assigns the id. */
export const insertOperation = (
  ctx: OperationContext,
  operation: NewOperation,
  reason: string,
): Effect.Effect<StoredOperation> =>
  Effect.tap(ctx.operationStore.insert(operation), (stored) =>
    Effect.sync(() =>
      ctx.inspector.emit(
        () =>
          new OperationChanged(
            {
              operationId: stored.id,
              kind: stored.kind,
              from: null,
              to: stored.status,
              reason,
            },
            { disableValidation: true },
          ),
      ),
    ),
  );

/** Patches an operation; a status change is reported. */
export const patchOperation = (
  ctx: OperationContext,
  operation: StoredOperation,
  patch: OperationPatch,
  reason: string,
): Effect.Effect<void> =>
  Effect.tap(ctx.operationStore.update(operation.id, patch), () =>
    Effect.sync(() => {
      if (patch.status === undefined || patch.status === operation.status)
        return;
      const to = patch.status;
      ctx.inspector.emit(
        () =>
          new OperationChanged(
            {
              operationId: operation.id,
              kind: operation.kind,
              from: operation.status,
              to,
              reason,
            },
            { disableValidation: true },
          ),
      );
    }),
  );
