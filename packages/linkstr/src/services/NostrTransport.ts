import { Context, Duration, Effect, Layer, Schema } from "effect";
import { SimplePool } from "nostr-tools";
import type { Event as NostrToolsEvent, Filter } from "nostr-tools";
import { RelayUrl } from "../domain/primitives";
import { acquireRelayPool } from "../internal/relayPoolLifetime";
import type { SignedPlainEvent, SignedWrapEvent } from "../internal/nostrEvent";

export class RelayPublishResult extends Schema.Class<RelayPublishResult>(
  "RelayPublishResult",
)({
  relay: RelayUrl,
  accepted: Schema.Boolean,
  detail: Schema.NullOr(Schema.String),
}) {}

export class RelayUnreachable extends Schema.TaggedError<RelayUnreachable>()(
  "RelayUnreachable",
  {
    relay: RelayUrl,
    detail: Schema.NullOr(Schema.String),
  },
) {}

/**
 * Publishing never fails as an Effect: it reports a per-relay outcome and the
 * caller derives delivery semantics. Retry policy deliberately does not live
 * here — it belongs to the outbox.
 *
 * Subscribing runs one live subscription on one relay: raw events flow through
 * `onEvent` until the relay ends the subscription, which resolves the effect
 * with the close reason. Interruption closes the subscription. Resubscribe and
 * backfill policy live in the inbox machine, not here.
 *
 * Fetching is the one-shot variant: collect stored events from one relay until
 * EOSE, then close. A relay that sends events but no EOSE before the timeout
 * yields what arrived; one that sends neither, or closes the subscription
 * first, fails with `RelayUnreachable`, so an empty result means the relay
 * really holds nothing.
 *
 * Relays under load drop a REQ without sending EOSE or CLOSED, so subscribing
 * and fetching send a REQ still without EOSE halfway to the EOSE timeout once
 * more, on a fresh subscription, and keep whichever answers first. A relay
 * that cannot be reached is not asked again.
 */
export interface RequestOptions {
  /** Invoked when the relay left the REQ unanswered and it is sent again. */
  readonly onRequestResent?: () => void;
}

export interface SubscribeOptions extends RequestOptions {
  readonly alreadyHaveEvent?: (id: string) => boolean;
  /**
   * Invoked when the relay signals end-of-stored-events for the subscription.
   * The pool transport fires it at the EOSE timeout when the relay never
   * sends one, so with the pool transport this always fires.
   */
  readonly onEose?: () => void;
}

export interface NostrTransportService {
  readonly publish: (
    relays: ReadonlyArray<RelayUrl>,
    event: SignedWrapEvent | SignedPlainEvent,
  ) => Effect.Effect<ReadonlyArray<RelayPublishResult>>;
  readonly subscribe: (
    relay: RelayUrl,
    filter: Filter,
    onEvent: (event: NostrToolsEvent) => void,
    options?: SubscribeOptions,
  ) => Effect.Effect<string, RelayUnreachable>;
  readonly fetch: (
    relay: RelayUrl,
    filter: Filter,
    options?: RequestOptions,
  ) => Effect.Effect<ReadonlyArray<NostrToolsEvent>, RelayUnreachable>;
}

export class NostrTransport extends Context.Service<
  NostrTransport,
  NostrTransportService
>()("linkstr/NostrTransport") {}

export interface RelaySubscriptionParams {
  readonly onevent: (event: NostrToolsEvent) => void;
  readonly alreadyHaveEvent?: (id: string) => boolean;
  readonly oneose?: () => void;
  readonly onclose?: (reason: string) => void;
  /** After it, nostr-tools fires `oneose` itself although the relay sent none. */
  readonly eoseTimeout?: number;
}

export interface RelaySubscriptionHandle {
  readonly close: (reason?: string) => void;
}

export interface RelayConnection {
  readonly publish: (event: NostrToolsEvent) => Promise<string>;
  readonly subscribe: (
    filters: Array<Filter>,
    params: RelaySubscriptionParams,
  ) => RelaySubscriptionHandle;
}

/** The slice of a nostr-tools pool the transport needs; fakeable in tests. */
export interface RelayPool {
  readonly ensureRelay: (
    url: string,
    params?: { connectionTimeout?: number },
  ) => Promise<RelayConnection>;
}

const CONNECTION_TIMEOUT_MS = 6_000;
const DEFAULT_PUBLISH_TIMEOUT = Duration.seconds(10);
const DEFAULT_EOSE_TIMEOUT = Duration.seconds(5);

interface StoredEventsRequest {
  readonly onevent: (event: NostrToolsEvent) => void;
  readonly alreadyHaveEvent: ((id: string) => boolean) | undefined;
  /** The first EOSE, from whichever REQ sent it. */
  readonly oneose: () => void;
  /** No REQ answered with EOSE within the EOSE timeout. */
  readonly ondeadline: () => void;
  readonly onclose: (reason: string) => void;
  readonly onresent: (() => void) | undefined;
}

interface SentRequest {
  open: boolean;
  handle: RelaySubscriptionHandle | null;
}

/**
 * Sends `filter` as a REQ and, when no EOSE arrived halfway to the timeout,
 * once more on a fresh subscription; until the replay ends, an event both
 * deliver arrives once. The first EOSE closes the other REQ, and so does the
 * deadline, which keeps the newer one. A CLOSED on either ends both.
 */
const requestStoredEvents = (
  connection: RelayConnection,
  filter: Filter,
  eoseTimeoutMs: number,
  params: StoredEventsRequest,
): RelaySubscriptionHandle => {
  const sent: Array<SentRequest> = [];
  const delivered = new Set<string>();
  let replaying = true;
  const close = (request: SentRequest) => {
    if (!request.open) return;
    request.open = false;
    request.handle?.close();
  };
  const endReplay = (keep: SentRequest | null) => {
    replaying = false;
    clearTimeout(timer);
    delivered.clear();
    for (const request of sent) if (request !== keep) close(request);
  };
  const send = () => {
    const request: SentRequest = { open: true, handle: null };
    sent.push(request);
    request.handle = connection.subscribe([filter], {
      onevent: (event) => {
        if (!request.open) return;
        if (replaying) {
          if (delivered.has(event.id)) return;
          delivered.add(event.id);
        }
        params.onevent(event);
      },
      ...(params.alreadyHaveEvent === undefined
        ? {}
        : { alreadyHaveEvent: params.alreadyHaveEvent }),
      oneose: () => {
        if (!request.open || !replaying) return;
        endReplay(request);
        params.oneose();
      },
      onclose: (reason) => {
        if (!request.open) return;
        request.open = false;
        endReplay(null);
        params.onclose(reason);
      },
      // Keeps nostr-tools from faking an EOSE before the deadline below.
      eoseTimeout: eoseTimeoutMs * 2,
    });
  };
  let timer = setTimeout(() => {
    params.onresent?.();
    send();
    if (!replaying) return;
    timer = setTimeout(() => {
      endReplay(sent.at(-1) ?? null);
      params.ondeadline();
    }, eoseTimeoutMs / 2);
  }, eoseTimeoutMs / 2);
  send();
  return { close: () => endReplay(null) };
};

/**
 * `SimplePool.publish` resolves — not rejects — with a "connection failure: …"
 * string for unreachable relays, so it cannot distinguish acceptance from
 * failure. Going through `ensureRelay().publish()` keeps the pool's connection
 * reuse while only an actual relay OK resolves the promise.
 */
export const makeRelayPoolTransport = (
  pool: RelayPool,
  options?: {
    allowInsecureLocalhost?: boolean | undefined;
    publishTimeout?: Duration.Duration;
    eoseTimeout?: Duration.Duration;
  },
): NostrTransportService => {
  const publishTimeout = options?.publishTimeout ?? DEFAULT_PUBLISH_TIMEOUT;
  const eoseTimeoutMs = Duration.toMillis(
    options?.eoseTimeout ?? DEFAULT_EOSE_TIMEOUT,
  );

  const ensureRelay = (relay: RelayUrl): Promise<RelayConnection> => {
    if (
      !Schema.is(RelayUrl)(relay) ||
      (new URL(relay).protocol !== "wss:" &&
        options?.allowInsecureLocalhost !== true)
    ) {
      return Promise.reject(
        new Error("Relay requires WSS; loopback WS needs explicit opt-in"),
      );
    }
    return pool.ensureRelay(relay, {
      connectionTimeout: CONNECTION_TIMEOUT_MS,
    });
  };

  /**
   * A nostr-tools relay keys a pending publish by event id, so publishing an
   * event again before its OK arrives orphans the first promise, which then
   * never settles. Callers that publish the same event twice (a retry, two
   * screens) share the one in flight instead.
   */
  const inFlight = new Map<string, Promise<string>>();
  const sendOnce = (
    relay: RelayUrl,
    event: SignedWrapEvent | SignedPlainEvent,
  ): Promise<string> => {
    const key = `${relay} ${event.id}`;
    const pending = inFlight.get(key);
    if (pending !== undefined) return pending;
    const sent = ensureRelay(relay)
      .then((connection) => connection.publish(event))
      .finally(() => inFlight.delete(key));
    inFlight.set(key, sent);
    return sent;
  };

  const publishToRelay = (
    relay: RelayUrl,
    event: SignedWrapEvent | SignedPlainEvent,
  ): Effect.Effect<RelayPublishResult> =>
    Effect.tryPromise({
      try: () => sendOnce(relay, event),
      catch: (reason) => String(reason),
    }).pipe(
      Effect.timeoutOrElse({
        duration: publishTimeout,
        orElse: () => Effect.fail("publish timed out"),
      }),
      Effect.match({
        onSuccess: (detail) =>
          new RelayPublishResult({
            relay,
            accepted: true,
            detail: detail || null,
          }),
        onFailure: (detail) =>
          new RelayPublishResult({ relay, accepted: false, detail }),
      }),
    );

  const subscribeToRelay = (
    relay: RelayUrl,
    filter: Filter,
    onEvent: (event: NostrToolsEvent) => void,
    options?: SubscribeOptions,
  ): Effect.Effect<string, RelayUnreachable> =>
    Effect.callback<string, RelayUnreachable>((resume) => {
      let handle: RelaySubscriptionHandle | null = null;
      let interrupted = false;
      const onEose = () => options?.onEose?.();
      ensureRelay(relay).then(
        (connection) => {
          if (interrupted) return;
          handle = requestStoredEvents(connection, filter, eoseTimeoutMs, {
            onevent: onEvent,
            alreadyHaveEvent: options?.alreadyHaveEvent,
            oneose: onEose,
            ondeadline: onEose,
            onclose: (reason) => resume(Effect.succeed(reason)),
            onresent: options?.onRequestResent,
          });
        },
        (reason) =>
          resume(
            Effect.fail(
              new RelayUnreachable({ relay, detail: String(reason) }),
            ),
          ),
      );
      return Effect.sync(() => {
        interrupted = true;
        handle?.close();
      });
    });

  const fetchFromRelay = (
    relay: RelayUrl,
    filter: Filter,
    options?: RequestOptions,
  ): Effect.Effect<ReadonlyArray<NostrToolsEvent>, RelayUnreachable> =>
    Effect.callback<ReadonlyArray<NostrToolsEvent>, RelayUnreachable>(
      (resume) => {
        const events: Array<NostrToolsEvent> = [];
        let handle: RelaySubscriptionHandle | null = null;
        let done = false;
        const settle = (unanswered: string | null) => {
          if (done) return;
          done = true;
          handle?.close();
          resume(
            unanswered !== null && events.length === 0
              ? Effect.fail(new RelayUnreachable({ relay, detail: unanswered }))
              : Effect.succeed(events),
          );
        };
        ensureRelay(relay).then(
          (connection) => {
            if (done) return;
            handle = requestStoredEvents(connection, filter, eoseTimeoutMs, {
              onevent: (event) => {
                events.push(event);
              },
              alreadyHaveEvent: undefined,
              oneose: () => settle(null),
              ondeadline: () => settle(`no EOSE within ${eoseTimeoutMs} ms`),
              onclose: (reason) => settle(`closed before EOSE: ${reason}`),
              onresent: options?.onRequestResent,
            });
          },
          (reason) => {
            if (done) return;
            done = true;
            resume(
              Effect.fail(
                new RelayUnreachable({ relay, detail: String(reason) }),
              ),
            );
          },
        );
        return Effect.sync(() => {
          done = true;
          handle?.close();
        });
      },
    );

  return {
    publish: (relays, event) =>
      Effect.forEach(relays, (relay) => publishToRelay(relay, event), {
        concurrency: "unbounded",
      }),
    subscribe: subscribeToRelay,
    fetch: fetchFromRelay,
  };
};

export const makeNostrTransportSimplePool = (options?: {
  allowInsecureLocalhost?: boolean | undefined;
}): Layer.Layer<NostrTransport> =>
  Layer.effect(
    NostrTransport,
    Effect.map(
      // Ping detects dropped websockets (mobile background, network
      // switch). Reconnect must stay OFF: nostr-tools re-fires
      // subscriptions with `since = lastEmitted + 1`, which strips the
      // NIP-59 backdate margin from gift-wrap filters and silently drops
      // backdated wraps for the rest of the session. A hard close instead
      // lets the inbox machine resubscribe with correct cursor-based
      // filters — resubscribe policy lives there, not in the transport.
      acquireRelayPool(
        () => new SimplePool({ enablePing: true, enableReconnect: false }),
      ),
      (pool) => makeRelayPoolTransport(pool, options),
    ),
  );

export const NostrTransportSimplePool = makeNostrTransportSimplePool();
