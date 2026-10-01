import { Effect, Layer, Option } from "effect";
import { SignedWrapEvent } from "../internal/nostrEvent";
import { NostrTransport } from "../services/NostrTransport";
import type { NostrTransportService } from "../services/NostrTransport";
import { Inspector } from "./Inspector";
import type { InspectorService } from "./Inspector";
import {
  WireEventReceived,
  WireFetched,
  WirePlainPublished,
  WirePublished,
  WireSubscribed,
  WireSubscriptionEnded,
} from "./events";

const tapWire = (
  inner: NostrTransportService,
  inspector: InspectorService,
): NostrTransportService => ({
  publish: (relays, event) =>
    inner
      .publish(relays, event)
      .pipe(
        Effect.tap((results) =>
          Effect.sync(() =>
            inspector.emit(() =>
              event instanceof SignedWrapEvent
                ? new WirePublished(
                    { wrapId: event.id, wrap: event, results },
                    { disableChecks: true },
                  )
                : new WirePlainPublished(
                    { eventId: event.id, kind: event.kind, event, results },
                    { disableChecks: true },
                  ),
            ),
          ),
        ),
      ),
  subscribe: (relay, filter, onEvent, options) =>
    Effect.suspend(() => {
      inspector.emit(
        () => new WireSubscribed({ relay, filter }, { disableChecks: true }),
      );
      return inner.subscribe(
        relay,
        filter,
        (event) => {
          inspector.emit(
            () =>
              new WireEventReceived({ relay, event }, { disableChecks: true }),
          );
          onEvent(event);
        },
        options,
      );
    }).pipe(
      Effect.tap((reason) =>
        Effect.sync(() =>
          inspector.emit(
            () =>
              new WireSubscriptionEnded(
                { relay, detail: reason },
                { disableChecks: true },
              ),
          ),
        ),
      ),
      Effect.tapError((error) =>
        Effect.sync(() =>
          inspector.emit(
            () =>
              new WireSubscriptionEnded(
                { relay, detail: error.detail },
                { disableChecks: true },
              ),
          ),
        ),
      ),
    ),
  fetch: (relay, filter) =>
    inner.fetch(relay, filter).pipe(
      Effect.tap((events) =>
        Effect.sync(() =>
          inspector.emit(
            () =>
              new WireFetched(
                { relay, filter, events, detail: null },
                { disableChecks: true },
              ),
          ),
        ),
      ),
      Effect.tapError((error) =>
        Effect.sync(() =>
          inspector.emit(
            () =>
              new WireFetched(
                { relay, filter, events: [], detail: error.detail },
                { disableChecks: true },
              ),
          ),
        ),
      ),
    ),
});

/**
 * Decorates whatever transport layer it is given with wire-level inspector
 * events; a pass-through when no `Inspector` is provided.
 */
export const inspectTransport = (
  transport: Layer.Layer<NostrTransport>,
): Layer.Layer<NostrTransport> =>
  Layer.effect(
    NostrTransport,
    Effect.map(
      Effect.all([NostrTransport, Effect.serviceOption(Inspector)]),
      ([inner, inspector]) =>
        Option.match(inspector, {
          onNone: () => inner,
          onSome: (service) => tapWire(inner, service),
        }),
    ),
  ).pipe(Layer.provide(transport));
