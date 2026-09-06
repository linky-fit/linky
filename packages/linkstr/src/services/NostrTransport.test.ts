import { Duration, Effect, Exit, Fiber } from "effect";
import { generateSecretKey, getEventHash, getPublicKey } from "nostr-tools";
import {
  NostrSecretKey,
  Pubkey,
  RelayUrl,
  UnixSeconds,
} from "../domain/primitives";
import { wrapRumorFor } from "../internal/giftWrap";
import { Rumor } from "../internal/nostrEvent";
import { eventually } from "../testing";
import { makeRelayPoolTransport } from "./NostrTransport";
import type { RelayPool, RelaySubscriptionParams } from "./NostrTransport";

const secretKey = NostrSecretKey.make(generateSecretKey());
const pubkey = Pubkey.make(getPublicKey(secretKey));

const rumorFields = {
  pubkey,
  created_at: UnixSeconds.make(1_754_000_000),
  kind: 7,
  tags: [["p", pubkey]],
  content: "👍",
};
const event = wrapRumorFor(
  new Rumor({ ...rumorFields, id: getEventHash(rumorFields) }),
  secretKey,
  pubkey,
);

const relayOk = RelayUrl.make("wss://ok.test");
const relayRejecting = RelayUrl.make("wss://rejecting.test");
const relayDown = RelayUrl.make("wss://down.test");
const relayHanging = RelayUrl.make("wss://hanging.test");

const subscribeUnsupported = (): never => {
  throw new Error("subscribe not under test");
};

const fakePool: RelayPool = {
  ensureRelay: async (url) => {
    if (url === relayDown) throw new Error("connection refused");
    return {
      publish: (published) => {
        expect(published.id).toBe(event.id);
        if (url === relayRejecting) {
          return Promise.reject(new Error("blocked: no active subscription"));
        }
        if (url === relayHanging) return new Promise(() => {});
        return Promise.resolve("stored");
      },
      subscribe: subscribeUnsupported,
    };
  },
};

const transport = makeRelayPoolTransport(fakePool, {
  publishTimeout: Duration.millis(100),
});

describe("makeRelayPoolTransport", () => {
  it("reports acceptance, rejection, connection failure and timeout per relay", async () => {
    const results = await Effect.runPromise(
      transport.publish(
        [relayOk, relayRejecting, relayDown, relayHanging],
        event,
      ),
    );

    expect(results).toEqual([
      expect.objectContaining({
        relay: relayOk,
        accepted: true,
        detail: "stored",
      }),
      expect.objectContaining({
        relay: relayRejecting,
        accepted: false,
        detail: "Error: blocked: no active subscription",
      }),
      expect.objectContaining({
        relay: relayDown,
        accepted: false,
        detail: "Error: connection refused",
      }),
      expect.objectContaining({
        relay: relayHanging,
        accepted: false,
        detail: "publish timed out",
      }),
    ]);
  });
});

interface FakeSubscription {
  readonly params: RelaySubscriptionParams;
  closedByClient: boolean;
}

const makeSubscribingPool = (): {
  pool: RelayPool;
  subscriptions: Array<FakeSubscription>;
} => {
  const subscriptions: Array<FakeSubscription> = [];
  const pool: RelayPool = {
    ensureRelay: async (url) => {
      if (url === relayDown) throw new Error("connection refused");
      return {
        publish: () => Promise.resolve("stored"),
        subscribe: (_filters, params) => {
          const subscription: FakeSubscription = {
            params,
            closedByClient: false,
          };
          subscriptions.push(subscription);
          return {
            close: () => {
              subscription.closedByClient = true;
            },
          };
        },
      };
    },
  };
  return { pool, subscriptions };
};

describe("makeRelayPoolTransport subscribe", () => {
  it("delivers events until the relay closes, then resolves with the reason", async () => {
    const { pool, subscriptions } = makeSubscribingPool();
    const received: Array<string> = [];

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(
          makeRelayPoolTransport(pool).subscribe(
            relayOk,
            { kinds: [1059] },
            (incoming) => {
              received.push(incoming.id);
            },
          ),
        );
        yield* eventually(() => subscriptions.length === 1);
        const [subscription] = subscriptions;
        if (subscription === undefined) throw new Error("never subscribed");
        subscription.params.onevent(event);
        subscription.params.onclose?.("relay says bye");
        return yield* Fiber.join(fiber);
      }),
    );

    expect(received).toEqual([event.id]);
    expect(result).toBe("relay says bye");
  });

  it("fails with RelayUnreachable when the relay cannot be reached", async () => {
    const { pool } = makeSubscribingPool();

    const exit = await Effect.runPromiseExit(
      makeRelayPoolTransport(pool).subscribe(
        relayDown,
        { kinds: [1059] },
        () => {
          throw new Error("no events from an unreachable relay");
        },
      ),
    );

    expect(exit).toEqual(
      Exit.fail(
        expect.objectContaining({
          _tag: "RelayUnreachable",
          relay: relayDown,
          detail: "Error: connection refused",
        }),
      ),
    );
  });

  it("closes the subscription when interrupted", async () => {
    const { pool, subscriptions } = makeSubscribingPool();

    await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(
          makeRelayPoolTransport(pool).subscribe(
            relayOk,
            { kinds: [1059] },
            () => {},
          ),
        );
        yield* eventually(() => subscriptions.length === 1);
        yield* Fiber.interrupt(fiber);
      }),
    );

    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]?.closedByClient).toBe(true);
  });
});

describe("makeRelayPoolTransport fetch", () => {
  it("collects until EOSE, then closes and resolves", async () => {
    const { pool, subscriptions } = makeSubscribingPool();

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(
          makeRelayPoolTransport(pool).fetch(relayOk, { kinds: [0] }),
        );
        yield* eventually(() => subscriptions.length === 1);
        const [subscription] = subscriptions;
        if (subscription === undefined) throw new Error("never subscribed");
        subscription.params.onevent(event);
        subscription.params.oneose?.();
        return yield* Fiber.join(fiber);
      }),
    );

    expect(result.map((received) => received.id)).toEqual([event.id]);
    expect(subscriptions[0]?.closedByClient).toBe(true);
  });

  it("resolves with what was collected when EOSE never arrives", async () => {
    const { pool, subscriptions } = makeSubscribingPool();

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(
          makeRelayPoolTransport(pool, {
            fetchEoseTimeout: Duration.millis(50),
          }).fetch(relayOk, { kinds: [0] }),
        );
        yield* eventually(() => subscriptions.length === 1);
        subscriptions[0]?.params.onevent(event);
        return yield* Fiber.join(fiber);
      }),
    );

    expect(result.map((received) => received.id)).toEqual([event.id]);
    expect(subscriptions[0]?.closedByClient).toBe(true);
  });

  it("fails with RelayUnreachable when the relay cannot be reached", async () => {
    const { pool } = makeSubscribingPool();

    const exit = await Effect.runPromiseExit(
      makeRelayPoolTransport(pool).fetch(relayDown, { kinds: [0] }),
    );

    expect(exit).toEqual(
      Exit.fail(
        expect.objectContaining({
          _tag: "RelayUnreachable",
          relay: relayDown,
        }),
      ),
    );
  });
});
