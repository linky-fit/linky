import type { Event as NostrToolsEvent, Filter } from "nostr-tools";
import type {
  RelayConnection,
  RelayPool,
  RelaySubscriptionParams,
} from "../services/NostrTransport";

export interface FakeSubscription {
  readonly filters: Array<Filter>;
  readonly params: RelaySubscriptionParams;
  closed: boolean;
}

export interface FakeRelayOptions {
  /** Close reason for filters the relay refuses, like a strict production relay. */
  readonly rejectFilters?: (filters: ReadonlyArray<Filter>) => string | null;
}

/** In-memory relay behind `makeRelayPoolTransport`; tests drive it by hand. */
export class FakeRelay {
  readonly subscriptions: Array<FakeSubscription> = [];
  /** Event ids the transport asked `alreadyHaveEvent` about. */
  readonly alreadyHaveChecks: Array<string> = [];
  connectAttempts = 0;
  down = false;

  readonly connection: RelayConnection;

  constructor(options?: FakeRelayOptions) {
    this.connection = {
      publish: () => Promise.resolve("stored"),
      subscribe: (filters, params) => {
        const subscription: FakeSubscription = {
          filters,
          params,
          closed: false,
        };
        this.subscriptions.push(subscription);
        const rejection = options?.rejectFilters?.(filters) ?? null;
        if (rejection !== null) {
          subscription.closed = true;
          params.onclose?.(rejection);
        }
        return {
          close: () => {
            subscription.closed = true;
          },
        };
      },
    };
  }

  emit(event: NostrToolsEvent): void {
    for (const subscription of this.subscriptions) {
      if (subscription.closed) continue;
      const alreadyHaveEvent = subscription.params.alreadyHaveEvent;
      if (alreadyHaveEvent !== undefined) {
        this.alreadyHaveChecks.push(event.id);
        if (alreadyHaveEvent(event.id)) continue;
      }
      subscription.params.onevent(event);
    }
  }

  eose(): void {
    for (const subscription of this.subscriptions) {
      if (!subscription.closed) subscription.params.oneose?.();
    }
  }

  closeFromRelay(reason: string): void {
    for (const subscription of this.subscriptions) {
      if (subscription.closed) continue;
      subscription.closed = true;
      subscription.params.onclose?.(reason);
    }
  }
}

export const poolFor = (fakes: ReadonlyMap<string, FakeRelay>): RelayPool => ({
  ensureRelay: (url) => {
    const relay = fakes.get(url);
    if (relay === undefined) return Promise.reject(new Error("unknown relay"));
    relay.connectAttempts++;
    if (relay.down) return Promise.reject(new Error("connection refused"));
    return Promise.resolve(relay.connection);
  },
});
