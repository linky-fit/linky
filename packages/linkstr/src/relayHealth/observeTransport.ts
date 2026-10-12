import { Effect, Layer, Option } from "effect";
import { NostrTransport } from "../services/NostrTransport";
import type { NostrTransportService } from "../services/NostrTransport";
import { RelayHealth } from "./RelayHealth";
import type { RelayHealthService } from "./RelayHealth";

const tapHealth = (
  inner: NostrTransportService,
  health: RelayHealthService,
): NostrTransportService => ({
  publish: (relays, event) =>
    inner.publish(relays, event).pipe(
      Effect.tap((results) =>
        Effect.sync(() => {
          for (const result of results) health.reportPublishResult(result);
        }),
      ),
    ),
  subscribe: (relay, filter, onEvent, options) =>
    Effect.suspend(() => {
      health.reportSubscribing(relay);
      return inner.subscribe(
        relay,
        filter,
        (event) => {
          health.reportSeen(relay);
          onEvent(event);
        },
        {
          ...options,
          onEose: () => {
            health.reportSeen(relay);
            options?.onEose?.();
          },
        },
      );
    }).pipe(
      Effect.tap((reason) =>
        Effect.sync(() => health.reportUnreachable(relay, reason)),
      ),
      Effect.tapError((error) =>
        Effect.sync(() => health.reportUnreachable(relay, error.detail)),
      ),
    ),
  fetch: (relay, filter, options) =>
    inner.fetch(relay, filter, options).pipe(
      Effect.tap(() => Effect.sync(() => health.reportSeen(relay))),
      Effect.tapError((error) =>
        Effect.sync(() => health.reportUnreachable(relay, error.detail)),
      ),
    ),
});

/**
 * Decorates whatever transport layer it is given so relay health is folded
 * from real traffic — the subscribers (WrapInbox, ProfileWatch, …) stay
 * untouched. A pass-through when no `RelayHealth` is provided.
 */
export const observeTransport = (
  transport: Layer.Layer<NostrTransport>,
): Layer.Layer<NostrTransport> =>
  Layer.effect(
    NostrTransport,
    Effect.map(
      Effect.all([NostrTransport, Effect.serviceOption(RelayHealth)]),
      ([inner, health]) =>
        Option.match(health, {
          onNone: () => inner,
          onSome: (service) => tapHealth(inner, service),
        }),
    ),
  ).pipe(Layer.provide(transport));
