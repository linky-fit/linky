import { Effect, Layer } from "effect";
import type { RelayUrl } from "../domain/primitives";
import {
  LINKY_PUSH_MARKER_TAG,
  LINKY_PUSH_MARKER_VALUE,
} from "../internal/giftWrap";
import {
  firstTagValue,
  SignedPlainEvent,
  SignedWrapEvent,
} from "../internal/nostrEvent";
import type { NostrTags } from "../internal/nostrEvent";
import { NostrTransport, RelayPublishResult } from "../services/NostrTransport";
import type { NostrTransportService } from "../services/NostrTransport";

export const recipientOf = (event: {
  readonly tags: NostrTags;
}): string | null => firstTagValue(event.tags, "p");

export const hasPushMarker = (wrap: SignedWrapEvent): boolean =>
  wrap.tags.some(
    (tag) =>
      tag[0] === LINKY_PUSH_MARKER_TAG && tag[1] === LINKY_PUSH_MARKER_VALUE,
  );

export type AcceptPublish<E> = (event: E, relay: RelayUrl) => boolean;

/** `subscribe` and `fetch` die unless a test supplies them. */
export type StubTransportOptions = Partial<
  Pick<NostrTransportService, "subscribe" | "fetch">
>;

const recordingTransport = <E extends SignedWrapEvent | SignedPlainEvent>(
  isExpected: (event: SignedWrapEvent | SignedPlainEvent) => event is E,
  published: Array<E>,
  accept: AcceptPublish<E>,
  options?: StubTransportOptions,
): NostrTransportService => ({
  publish: (relays, event) =>
    Effect.sync(() => {
      if (!isExpected(event)) {
        throw new Error(`unexpected publish of ${event.constructor.name}`);
      }
      published.push(event);
      return relays.map((relay) => {
        const accepted = accept(event, relay);
        return new RelayPublishResult({
          relay,
          accepted,
          detail: accepted ? null : "blocked",
        });
      });
    }),
  subscribe:
    options?.subscribe ?? (() => Effect.die("subscribe not under test")),
  fetch: options?.fetch ?? (() => Effect.die("fetch not under test")),
});

const isWrap = (
  event: SignedWrapEvent | SignedPlainEvent,
): event is SignedWrapEvent => event instanceof SignedWrapEvent;

const isPlain = (
  event: SignedWrapEvent | SignedPlainEvent,
): event is SignedPlainEvent => event instanceof SignedPlainEvent;

/** Publish stub for gift-wrap verticals: records every wrap, answers per (wrap, relay). */
export const stubWrapTransportService = (
  published: Array<SignedWrapEvent>,
  accept: AcceptPublish<SignedWrapEvent> = () => true,
  options?: StubTransportOptions,
): NostrTransportService =>
  recordingTransport(isWrap, published, accept, options);

export const stubWrapTransport = (
  published: Array<SignedWrapEvent>,
  accept: AcceptPublish<SignedWrapEvent> = () => true,
  options?: StubTransportOptions,
): Layer.Layer<NostrTransport> =>
  Layer.succeed(
    NostrTransport,
    stubWrapTransportService(published, accept, options),
  );

/** Publish stub for plain-event verticals (profiles, relay lists, mute list). */
export const stubPlainTransport = (
  published: Array<SignedPlainEvent>,
  accept: AcceptPublish<SignedPlainEvent> = () => true,
  options?: StubTransportOptions,
): Layer.Layer<NostrTransport> =>
  Layer.succeed(
    NostrTransport,
    recordingTransport(isPlain, published, accept, options),
  );
