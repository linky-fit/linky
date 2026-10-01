import { Effect } from "effect";
import type { EventId, WrapId } from "../domain/primitives";
import type { InspectorService } from "../inspector/Inspector";
import { OperationFailed, PlainOperationSucceeded } from "../inspector/events";
import { redactInspectorSecrets } from "./redactInspectorSecrets";

export interface InspectedPlainResult<A> {
  readonly result: A;
  /** Signed events the operation published or read, for wire-row correlation. */
  readonly eventIds: ReadonlyArray<EventId | WrapId>;
}

/** Plain-event sibling of the reactions inspector tap. */
export const inspectPlainOperation =
  (inspector: InspectorService, name: string, params: unknown) =>
  <A, E>(
    operation: Effect.Effect<InspectedPlainResult<A>, E>,
  ): Effect.Effect<A, E> =>
    operation.pipe(
      Effect.tap(({ eventIds, result }) =>
        Effect.sync(() =>
          inspector.emit(
            () =>
              new PlainOperationSucceeded(
                {
                  name,
                  params: redactInspectorSecrets(params),
                  eventIds,
                  result: redactInspectorSecrets(result),
                },
                { disableChecks: true },
              ),
          ),
        ),
      ),
      Effect.map(({ result }) => result),
      Effect.tapError((error) =>
        Effect.sync(() =>
          inspector.emit(
            () =>
              new OperationFailed(
                { name, params: redactInspectorSecrets(params), error },
                { disableChecks: true },
              ),
          ),
        ),
      ),
    );
