import { Effect, Exit, Scope } from "effect";
import { RelayUrl } from "../domain/primitives";
import { makeRelayPoolTransport } from "../services/NostrTransport";
import type { RelayPool } from "../services/NostrTransport";
import { eventually } from "../testing";
import { acquireRelayPool } from "./relayPoolLifetime";

interface Frame {
  readonly frame: string;
  readonly socketOpen: boolean;
}

/** Mirrors nostr-tools: frames go out a microtask late, destroy closes open subscriptions then the socket. */
const makeNostrToolsLikePool = () => {
  const frames: Array<Frame> = [];
  const openSubscriptions = new Set<() => void>();
  let socketOpen = true;
  const send = (frame: string) =>
    queueMicrotask(() => frames.push({ frame, socketOpen }));
  const pool: RelayPool & { readonly destroy: () => void } = {
    ensureRelay: () =>
      Promise.resolve({
        publish: () => Promise.resolve(""),
        subscribe: (_filters, params) => {
          send("REQ");
          const close = () => {
            if (!openSubscriptions.delete(close)) return;
            send("CLOSE");
            params.onclose?.("closed by caller");
          };
          openSubscriptions.add(close);
          return { close };
        },
      }),
    destroy: () => {
      openSubscriptions.forEach((close) => close());
      socketOpen = false;
    },
  };
  return { pool, frames, openSubscriptions };
};

describe("acquireRelayPool", () => {
  it("sends a subscription's CLOSE before closing the socket when released under a live subscriber", async () => {
    const { pool, frames, openSubscriptions } = makeNostrToolsLikePool();

    await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make();
        const transport = makeRelayPoolTransport(
          yield* Scope.provide(
            acquireRelayPool(() => pool),
            scope,
          ),
        );
        yield* Effect.forkDetach(
          transport.subscribe(
            RelayUrl.make("wss://relay.test"),
            { kinds: [1059] },
            () => {},
          ),
        );
        yield* eventually(() => openSubscriptions.size === 1);
        yield* Scope.close(scope, Exit.void);
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(frames).toEqual([
      { frame: "REQ", socketOpen: true },
      { frame: "CLOSE", socketOpen: true },
    ]);
  });
});
