import {
  Bip39Seed,
  Inspector,
  linkshuServices,
  type KeyValueStore,
} from "@linky-fit/linkshu";
import {
  InboxCursorStore,
  linkstrServices,
  makeNostrTransportSimplePool,
  type NostrSecretKey,
  type OutboxStore,
  type NostrTransport,
  type RelayUrl,
} from "@linky-fit/linkstr";
import type { WalletRepository } from "@linky-fit/linksync";
import { Layer, ManagedRuntime } from "effect";

export interface LinkstrRuntimeConfig {
  readonly secretKey: NostrSecretKey;
  readonly relays: readonly RelayUrl[];
  readonly allowInsecureLocalhostRelays: boolean;
  /** The relay connection; tests pass a fake. */
  readonly transport?: Layer.Layer<NostrTransport> | undefined;
  /** Durable outbox jobs. */
  readonly outboxStore: Layer.Layer<OutboxStore>;
  /** Durable inbox cursor; in memory when omitted. */
  readonly inboxCursorStore?: Layer.Layer<InboxCursorStore> | undefined;
}

/** linkstr on the account's Nostr key: the one inbox and the one outbox of this launch. */
export const makeLinkstrRuntime = (config: LinkstrRuntimeConfig) =>
  ManagedRuntime.make(
    linkstrServices({
      secretKey: config.secretKey,
      readRelays: config.relays,
      writeRelays: config.relays,
      transport:
        config.transport ??
        makeNostrTransportSimplePool({
          allowInsecureLocalhost: config.allowInsecureLocalhostRelays,
        }),
      outboxStore: config.outboxStore,
      inboxCursorStore: config.inboxCursorStore ?? InboxCursorStore.inMemory,
    }),
  );

export type LinkstrRuntime = ReturnType<typeof makeLinkstrRuntime>;

/** linkshu on the account's cashu seed, with its proofs and operations in the synced wallet repository. */
export const makeLinkshuRuntime = (config: {
  readonly cashuSeed: Bip39Seed;
  readonly wallet: WalletRepository;
  /** Device-local counters and leases; in memory when omitted. */
  readonly keyValueStore?: Layer.Layer<KeyValueStore> | undefined;
}) =>
  ManagedRuntime.make(
    linkshuServices({
      bip39Seed: config.cashuSeed,
      keyValueStore: config.keyValueStore,
      proofStore: config.wallet.proofStore,
      operationStore: config.wallet.operationStore,
    }).pipe(Layer.provideMerge(Inspector.disabled)),
  );

export type LinkshuRuntime = ReturnType<typeof makeLinkshuRuntime>;
