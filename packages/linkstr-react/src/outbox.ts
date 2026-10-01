import { useAtomMount, useAtomSet } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { Outbox } from "@linky-fit/linkstr";
import type {
  OutboxRef,
  OutboxResult,
  RumorFixedOperation,
} from "@linky-fit/linkstr";
import { Effect, Stream } from "effect";
import { useEffect, useRef } from "react";
import { linkstrRuntimeAtom } from "./runtime";

export interface EnqueueOutboxInput {
  readonly op: RumorFixedOperation;
  readonly ref: OutboxRef;
}

export const enqueueOutboxAtom = linkstrRuntimeAtom.fn<EnqueueOutboxInput>()(
  ({ op, ref }) => Effect.flatMap(Outbox, (outbox) => outbox.enqueue(op, ref)),
);

/** An object (not a bare function) so setting it never hits the atom
 * setter's updater-form interpretation of function values. */
export interface OutboxResultsHandler {
  /** Persist the terminal; the job is acked only after this resolves. */
  readonly onResult: (result: OutboxResult) => Promise<void>;
}

/** Null leaves the results stream unconsumed; register exactly one handler. */
export const outboxResultsHandlerAtom = Atom.make<OutboxResultsHandler | null>(
  null,
);

/**
 * While mounted (and a handler is registered), consumes the single-consumer
 * outbox results stream: each terminal runs through the handler and is acked
 * only after the handler resolves. A rejected handler skips the ack, so the
 * terminal re-delivers when the outbox is next rebuilt.
 */
export const outboxResultsAtom = linkstrRuntimeAtom.atom((get) => {
  const handler = get(outboxResultsHandlerAtom);
  if (handler === null) return Stream.empty;
  return Stream.unwrap(
    Effect.map(Outbox, (outbox) =>
      Stream.mapEffect(outbox.results, (result) =>
        Effect.tryPromise(() => handler.onResult(result)).pipe(
          Effect.andThen(outbox.ack(result.jobId)),
          Effect.catch(() => Effect.void),
          Effect.as(result),
        ),
      ),
    ),
  );
});

/** Subscribes the outbox results stream for the component's lifetime. */
export const useOutboxResults = (
  handler: (result: OutboxResult) => Promise<void>,
): void => {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  const setHandler = useAtomSet(outboxResultsHandlerAtom);
  useAtomMount(outboxResultsAtom);
  useEffect(() => {
    setHandler({ onResult: (result) => latest.current(result) });
    return () => {
      setHandler(null);
    };
  }, [setHandler]);
};
