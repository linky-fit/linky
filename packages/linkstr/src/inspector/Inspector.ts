import { Cause, Context, Effect, Layer, Option, Queue, Stream } from "effect";
import type { InspectorEvent } from "./events";
import { acquireStreamQueue } from "../internal/streamQueue";

// Sliding, because inspection must never stall or leak memory when nobody is
// consuming: old diagnostics are droppable by design.
const BUFFER_CAPACITY = 1024;

export interface InspectorService {
  /**
   * Sync so transport callbacks can emit without running Effects, lazy so the
   * builder is not invoked when nobody consumes, and total so a throwing
   * builder is logged and dropped, never a defect of the observed operation.
   */
  readonly emit: (build: () => InspectorEvent) => void;
  /** Single-consumer, like `WrapInboxFeed.events`; fan out downstream. */
  readonly events: Stream.Stream<InspectorEvent>;
}

const noop: InspectorService = { emit: () => {}, events: Stream.empty };

/**
 * Optional diagnostics bus. Services emit through `Inspector.orNoop`, so
 * providing no layer costs nothing; a composition root that wants the feed
 * provides `Inspector.live` and consumes `events`.
 */
export class Inspector extends Context.Service<Inspector, InspectorService>()(
  "linkstr/Inspector",
) {
  static readonly live: Layer.Layer<Inspector> = Layer.effect(
    Inspector,
    Effect.map(
      acquireStreamQueue(
        Queue.sliding<InspectorEvent, Cause.Done>(BUFFER_CAPACITY),
      ),
      (queue) => ({
        emit: (build) => {
          try {
            Queue.offerUnsafe(queue, build());
          } catch (error) {
            console.warn("linkstr inspector emission failed", error);
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
