import { Effect, Struct } from "effect";
import type { TokenText } from "../domain/primitives";
import type { InspectorService } from "../inspector/Inspector";
import { OperationFailed, OperationSucceeded } from "../inspector/events";

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
      Effect.tapError((error) =>
        Effect.sync(() =>
          inspector.emit(
            () =>
              new OperationFailed(
                { name, params, error },
                { disableValidation: true },
              ),
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

/** Token text carries proof secrets; a receipt's other fields are safe. */
export const redactReceipt = <R extends { readonly tokenText: TokenText }>(
  receipt: R,
) => Struct.omit(receipt, "tokenText");
