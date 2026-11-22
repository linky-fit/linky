import { Restore, runLinkshu } from "@linky-fit/linkshu";
import {
  InboxCursorStore,
  OutboxStore,
  type NostrTransport,
} from "@linky-fit/linkstr";
import {
  markAwaitingFirstHydration,
  type LinkyEvoluEvent,
} from "@linky-fit/linksync/evolu";
import type { EsploraFetch } from "@linky-fit/onchain-transfer";
import { Effect, Result, type Layer } from "effect";
import * as path from "node:path";
import { createAppServices, type AppServices } from "../services/appServices";
import { deriveAccount, type Account } from "../storage/account";
import { readProfile } from "../storage/profile";
import { whenHydrated } from "../storage/repositories";
import type { DaemonConfig } from "./config";
import { openDaemonStore } from "./evolu";
import { openDaemonStorage } from "./storage";

const DAEMON_NPUB_KEY = "linky.onchainOperator.daemon.npub";

export interface DaemonLogger {
  readonly info: (message: string) => void;
  readonly warn: (message: string, detail?: unknown) => void;
}

const consoleLogger: DaemonLogger = {
  info: (message) => console.log(`[onchain-operator-daemon] ${message}`),
  warn: (message, detail) =>
    detail === undefined
      ? console.warn(`[onchain-operator-daemon] ${message}`)
      : console.warn(`[onchain-operator-daemon] ${message}`, detail),
};

export interface DaemonHandle {
  readonly account: Account;
  readonly services: AppServices;
  readonly stop: () => Promise<void>;
}

export interface StartDaemonOptions {
  readonly inMemory?: boolean | undefined;
  readonly transport?: Layer.Layer<NostrTransport> | undefined;
  readonly esploraFetch?: EsploraFetch | undefined;
  readonly logger?: DaemonLogger | undefined;
}

const logEvoluEvent = (logger: DaemonLogger) => (event: LinkyEvoluEvent) => {
  switch (event._tag) {
    case "AccountHydrated":
      logger.info(
        `Evolu account hydrated (${event.owners.length} owner${event.owners.length === 1 ? "" : "s"}).`,
      );
      break;
    case "OwnerSyncFailed":
      logger.warn(
        `Evolu sync error for owner ${event.ownerId}: ${event.error}`,
      );
      break;
    case "WriteFailed":
      logger.warn("Evolu could not store a write", event.write);
      break;
    case "ShardPointerRepairFailed":
      logger.warn("Evolu shard pointer repair failed", event.error);
      break;
    default:
      break;
  }
};

export const startOperatorDaemon = async (
  config: DaemonConfig,
  options: StartDaemonOptions = {},
): Promise<DaemonHandle> => {
  const logger = options.logger ?? consoleLogger;
  const derived = await Effect.runPromise(
    Effect.result(deriveAccount(config.recoverySeed)),
  );
  if (Result.isFailure(derived)) {
    throw new Error("Invalid recovery seed: expected a valid SLIP-39 share.");
  }
  const account = derived.success;

  const storage = openDaemonStorage(
    options.inMemory ? ":memory:" : path.join(config.dataDir, "state.sqlite"),
  );
  let storeClose: (() => Promise<void>) | null = null;
  try {
    const previousNpub = storage.kv.getItem(DAEMON_NPUB_KEY);
    if (previousNpub !== account.npub) {
      if (previousNpub !== null) {
        logger.info("Recovery seed changed; wiping seed-bound wallet state.");
        await runLinkshu(
          {
            bip39Seed: account.cashuSeed,
            keyValueStore: storage.linkshuKeyValueStore,
          },
          Effect.flatMap(Restore, (restore) => restore.wipeSeedBoundState),
        );
      }
      // Fresh data directory or new seed: hold writes until existing synced data arrives.
      const hasEvoluRelays =
        config.appConfig.evoluRelayDefaults.length > 0 ||
        config.appConfig.recommendedEvoluRelays.length > 0;
      if (hasEvoluRelays) {
        markAwaitingFirstHydration(storage.kv, account.appMnemonic);
      }
      storage.kv.setItem(DAEMON_NPUB_KEY, account.npub);
    }

    const opened = await openDaemonStore({
      account,
      config: config.appConfig,
      kv: storage.kv,
      memoryOnly: options.inMemory ?? false,
      onEvent: logEvoluEvent(logger),
    });
    storeClose = opened.close;

    const services = createAppServices({
      account,
      store: opened.store,
      config: config.appConfig,
      extraWatchers: config.extraWatchers,
      ports: {
        outboxStore: OutboxStore.fromStringStorage(
          storage.kv,
          `linky.onchainOperator.outbox.${account.pubkey}`,
        ),
        inboxCursorStore: InboxCursorStore.fromStringStorage(
          storage.kv,
          `linky.onchainOperator.inboxCursor.${account.pubkey}`,
        ),
        keyValueStore: storage.linkshuKeyValueStore,
        transport: options.transport,
        esploraFetch: options.esploraFetch ?? ((url) => fetch(url)),
        earlyEcashKv: storage.kv,
        blossomFetch: (input, init) => fetch(input, init),
        nip05Fetch: (input, init) => fetch(input, init),
      },
    });

    services.start();
    logger.info(
      `Started for ${account.npub} (network=${config.appConfig.network}, mint=${config.appConfig.mintUrl}, esplora=${config.appConfig.esploraUrl}, nostrRelays=${config.appConfig.nostrRelays.length}, evoluRelays=${opened.evoluRelays.length}, extraWatchers=${config.extraWatchers.length})`,
    );

    let stopped = false;
    void whenHydrated(opened.store).then(async () => {
      if (stopped) return;
      const profile = await Effect.runPromise(
        readProfile(services.repositories.settings),
      );
      if (profile === null) {
        logger.warn(
          "No synced operator profile found yet. Save your profile (including xpub) in the web operator console and it will sync here automatically.",
        );
      } else {
        const totalWatchers = new Set([
          ...profile.watchers,
          ...config.extraWatchers,
        ]).size;
        logger.info(
          `Synced profile "${profile.name}" loaded (paused=${profile.paused}, watchers=${totalWatchers}).`,
        );
      }
    });

    return {
      account,
      services,
      stop: async () => {
        if (stopped) return;
        stopped = true;
        await services.dispose();
        await storeClose?.();
        storage.close();
      },
    };
  } catch (error) {
    await storeClose?.();
    storage.close();
    throw error;
  }
};
