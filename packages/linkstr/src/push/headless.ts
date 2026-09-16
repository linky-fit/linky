import { Cause, Duration, Effect, Exit, Fiber, Layer, Stream } from "effect";
import type { RelayUrl } from "../domain/primitives";
import type { NostrTransport } from "../services/NostrTransport";
import { makeNostrTransportSimplePool } from "../services/NostrTransport";
import { RelayPolicy } from "../services/RelayPolicy";
import type {
  DeliveredPushWrap,
  PushRelayStatusEvent,
  PushWrapFailure,
} from "./PushInbox";
import { PushInbox } from "./PushInbox";

export interface PushInboxConfig {
  readonly allowInsecureLocalhost?: boolean | undefined;
  readonly readRelays: ReadonlyArray<RelayUrl>;
  readonly lookbackSeconds: number;
  readonly transport?: Layer.Layer<NostrTransport> | undefined;
  readonly refreshInterval?: Duration.Duration | undefined;
  readonly resubscribeDelay?: Duration.Duration | undefined;
  readonly onInvalidWrap?: ((failure: PushWrapFailure) => void) | undefined;
  readonly onRelayStatus?: ((event: PushRelayStatusEvent) => void) | undefined;
  readonly onFatal?: ((message: string) => void) | undefined;
}

export interface PushInboxSubscription {
  readonly close: () => Promise<void>;
}

/** Promise-facing, identity-free composition entry for long-lived services. */
export const watchPushInbox = (
  config: PushInboxConfig,
  onWrap: (event: DeliveredPushWrap) => void,
): PushInboxSubscription => {
  const program = Effect.gen(function* () {
    const inbox = yield* PushInbox;
    const events = yield* inbox.open({
      lookback: Duration.seconds(config.lookbackSeconds),
      ...(config.refreshInterval === undefined
        ? {}
        : { refreshInterval: config.refreshInterval }),
      ...(config.resubscribeDelay === undefined
        ? {}
        : { resubscribeDelay: config.resubscribeDelay }),
      ...(config.onInvalidWrap === undefined
        ? {}
        : { onInvalidWrap: config.onInvalidWrap }),
      ...(config.onRelayStatus === undefined
        ? {}
        : { onRelayStatus: config.onRelayStatus }),
    });
    yield* Stream.runForEach(events, (event) =>
      Effect.sync(() => onWrap(event)),
    );
  }).pipe(
    Effect.scoped,
    Effect.provide(
      PushInbox.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            RelayPolicy.fixed({
              readRelays: config.readRelays,
              writeRelays: [],
            }),
            config.transport ??
              makeNostrTransportSimplePool({
                allowInsecureLocalhost: config.allowInsecureLocalhost,
              }),
          ),
        ),
      ),
    ),
  );
  const fiber = Effect.runFork(program);
  fiber.addObserver((exit) => {
    if (Exit.isFailure(exit) && !Cause.isInterruptedOnly(exit.cause)) {
      config.onFatal?.(Cause.pretty(exit.cause));
    }
  });
  return {
    close: () => Effect.runPromise(Fiber.interrupt(fiber).pipe(Effect.asVoid)),
  };
};
