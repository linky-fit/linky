import { Effect } from "effect";
import type { Layer } from "effect";
import { linkstrServices } from "./composition";
import type { LinkstrServices } from "./composition";
import type { OutboxStore } from "./outbox/OutboxStore";
import type { NostrSecretKey, RelayUrl } from "./domain/primitives";
import { NostrTransportSimplePool } from "./services/NostrTransport";
import type { NostrTransport } from "./services/NostrTransport";

export interface LinkstrHeadlessConfig {
  readonly outboxStore?: Layer.Layer<OutboxStore> | undefined;
  readonly secretKey: NostrSecretKey;
  readonly readRelays: ReadonlyArray<RelayUrl>;
  /** Read-only consumers (the service worker) omit this. */
  readonly writeRelays?: ReadonlyArray<RelayUrl> | undefined;
  /** Test seam: replaces the real websocket transport when provided. */
  readonly transport?: Layer.Layer<NostrTransport> | undefined;
}

/**
 * Promise-facing one-shot runner for non-React environments (the service
 * worker): builds the services fresh, runs the effect, and tears everything
 * down again — the relay pool is scoped to this single run.
 */
export const runLinkstr = <A, E>(
  config: LinkstrHeadlessConfig,
  effect: Effect.Effect<A, E, LinkstrServices>,
): Promise<A> =>
  Effect.runPromise(
    Effect.provide(
      effect,
      linkstrServices({
        secretKey: config.secretKey,
        outboxStore: config.outboxStore,
        readRelays: config.readRelays,
        writeRelays: config.writeRelays ?? [],
        transport: config.transport ?? NostrTransportSimplePool,
      }),
    ),
  );
