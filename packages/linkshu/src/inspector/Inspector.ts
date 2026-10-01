import { Context, Effect, Layer, Option, Queue, Stream } from "effect";
import type { Cause } from "effect";
import type { LinkshuInspectorEvent } from "./events";

// Sliding, because inspection must never stall or leak memory when nobody is
// consuming: old diagnostics are droppable by design.
const BUFFER_CAPACITY = 1024;

export interface InspectorService {
  /**
   * Sync so hot paths can emit without running Effects, lazy so the builder
   * is not invoked when nobody consumes, and total so a throwing builder is
   * logged and dropped, never a defect of the observed operation.
   */
  readonly emit: (build: () => LinkshuInspectorEvent) => void;
  /** Single-consumer; fan out downstream. */
  readonly events: Stream.Stream<LinkshuInspectorEvent>;
}

const noop: InspectorService = { emit: () => {}, events: Stream.empty };

/**
 * Optional diagnostics bus, cloned from linkstr's `Inspector` (the packages
 * stay dependency-free of each other by design). Services emit through
 * `Inspector.orNoop`, so providing no layer costs nothing; a composition
 * root that wants the feed provides `Inspector.live` and consumes `events`.
 */
export class Inspector extends Context.Service<Inspector, InspectorService>()(
  "linkshu/Inspector",
) {
  /** Sliding in-memory buffer; old diagnostics are droppable by design. */
  static readonly live: Layer.Layer<Inspector> = Layer.effect(
    Inspector,
    Effect.map(
      Effect.acquireRelease(
        Queue.sliding<LinkshuInspectorEvent, Cause.Done>(BUFFER_CAPACITY),
        // Ending first completes `events`; a bare shutdown interrupts it.
        (queue) => Effect.andThen(Queue.end(queue), Queue.shutdown(queue)),
      ),
      (queue) => ({
        emit: (build) => {
          try {
            Queue.offerUnsafe(queue, build());
          } catch (error) {
            console.warn("linkshu inspector emission failed", error);
          }
        },
        events: Stream.fromQueue(queue),
      }),
    ),
  );

  /** For composition roots that provide the tag unconditionally. */
  static readonly disabled: Layer.Layer<Inspector> = Layer.succeed(
    Inspector,
    noop,
  );

  static readonly orNoop: Effect.Effect<InspectorService> = Effect.map(
    Effect.serviceOption(Inspector),
    Option.getOrElse(() => noop),
  );
}
