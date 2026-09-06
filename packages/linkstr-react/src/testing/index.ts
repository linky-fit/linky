import { NostrTransport, RelayPublishResult, RelayUrl } from "@linky/linkstr";
import type {
  LinkstrIdentityService,
  NostrTransportService,
} from "@linky/linkstr";
import { Effect, Layer } from "effect";
import type { Exit } from "effect";
import type { Event as NostrToolsEvent, Filter } from "nostr-tools";
import type { LinkstrConfig } from "../config";
import { Registry } from "../index";
import type { Atom, Result } from "../index";

export { makeIdentity } from "@linky/linkstr/testing";

export const relayA = RelayUrl.make("wss://relay-a.test");
export const relayB = RelayUrl.make("wss://relay-b.test");

/** One-relay config over `transport`; `overrides` win. */
export const configWith = (
  identity: LinkstrIdentityService,
  transport: Layer.Layer<NostrTransport>,
  overrides?: Partial<LinkstrConfig>,
): LinkstrConfig => ({
  secretKey: identity.secretKey,
  readRelays: [relayA],
  writeRelays: [relayA],
  transport,
  ...overrides,
});

/** Awaits an fn atom's Result; suspendOnWaiting skips the stale previous Result while a re-invocation runs. */
export const settle = <A, E>(
  registry: Registry.Registry,
  atom: Atom.Atom<Result.Result<A, E>>,
): Promise<Exit.Exit<A, E>> =>
  Effect.runPromiseExit(
    Registry.getResult(registry, atom, { suspendOnWaiting: true }),
  );

export type PublishedEvent = Parameters<NostrTransportService["publish"]>[1];

export interface FakeSubscription {
  readonly relay: RelayUrl;
  readonly filter: Filter;
  readonly onEvent: (event: NostrToolsEvent) => void;
}

/**
 * Accepts every publish, records subscriptions until they are interrupted,
 * and serves `stored` to every fetch.
 */
export const fakeTransport = (
  published: Array<PublishedEvent>,
  subscriptions: Array<FakeSubscription>,
  stored: ReadonlyArray<NostrToolsEvent> = [],
  fetchedFilters: Array<Filter> = [],
): NostrTransportService => ({
  publish: (relays, event) =>
    Effect.sync(() => {
      published.push(event);
      return relays.map(
        (relay) =>
          new RelayPublishResult({ relay, accepted: true, detail: null }),
      );
    }),
  subscribe: (relay, filter, onEvent) =>
    Effect.suspend(() => {
      const subscription: FakeSubscription = { relay, filter, onEvent };
      subscriptions.push(subscription);
      return Effect.never.pipe(
        Effect.ensuring(
          Effect.sync(() => {
            subscriptions.splice(subscriptions.indexOf(subscription), 1);
          }),
        ),
      );
    }),
  fetch: (_relay, filter) =>
    Effect.sync(() => {
      fetchedFilters.push(filter);
      return [...stored];
    }),
});

export const fakeTransportLayer = (
  ...args: Parameters<typeof fakeTransport>
): Layer.Layer<NostrTransport> =>
  Layer.succeed(NostrTransport, fakeTransport(...args));
