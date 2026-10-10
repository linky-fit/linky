import { Effect } from "effect";
import type { Scope } from "effect";
import type {
  RelayPool,
  RelaySubscriptionHandle,
} from "../services/NostrTransport";

const trackOpenSubscriptions = (
  pool: RelayPool,
  open: Set<RelaySubscriptionHandle>,
): RelayPool => ({
  ensureRelay: async (url, params) => {
    const connection = await pool.ensureRelay(url, params);
    return {
      publish: (event) => connection.publish(event),
      subscribe: (filters, subscriptionParams) => {
        const subscription: RelaySubscriptionHandle = {
          close: (reason) => {
            open.delete(subscription);
            handle.close(reason);
          },
        };
        open.add(subscription);
        const handle = connection.subscribe(filters, {
          ...subscriptionParams,
          onclose: (reason) => {
            open.delete(subscription);
            subscriptionParams.onclose?.(reason);
          },
        });
        return subscription;
      },
    };
  },
});

/**
 * The pool, scoped to the transport. Its subscribers can outlive it (an atom
 * runtime closes its scope before interrupting the fibers it runs), and
 * nostr-tools writes a CLOSE frame a microtask after `close()`, so release
 * closes the open subscriptions and lets their frames out before destroying
 * the pool and its sockets.
 */
export const acquireRelayPool = (
  make: () => RelayPool & { readonly destroy: () => void },
): Effect.Effect<RelayPool, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => ({
      pool: make(),
      open: new Set<RelaySubscriptionHandle>(),
    })),
    ({ pool, open }) =>
      Effect.sync(() =>
        open.forEach((subscription) => subscription.close()),
      ).pipe(
        Effect.andThen(Effect.promise(() => Promise.resolve())),
        Effect.andThen(Effect.sync(() => pool.destroy())),
      ),
  ).pipe(Effect.map(({ pool, open }) => trackOpenSubscriptions(pool, open)));
