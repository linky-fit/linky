import { Restore, runLinkshu } from "@linky-fit/linkshu";
import type { LinkyStore } from "@linky-fit/linksync";
import {
  markAwaitingFirstHydration,
  type KeyValueStorage,
} from "@linky-fit/linksync/evolu";
import { Effect, Result } from "effect";
import type { AppConfig } from "../config";
import type { ShopProfile } from "../domain";
import {
  createRecoverySeed,
  deriveAccount,
  loadStoredAccount,
  storeAccount,
  type Account,
  type InvalidRecoverySeed,
} from "../storage/account";
import {
  createAppServices,
  type AppServices,
  type ServicePorts,
} from "./appServices";

/** Where this device stands with an account. */
export type Session =
  | { readonly _tag: "SignedOut" }
  /** An account is being created or restored, or its database is opening. */
  | { readonly _tag: "Opening" }
  | {
      readonly _tag: "SignedIn";
      readonly services: AppServices;
      /** The account came from a recovery seed; its shop arrives once it syncs. */
      readonly restored: boolean;
    };

/** This device's account lifecycle: create, restore, reset. */
export interface Device {
  readonly session: () => Session;
  readonly subscribe: (listener: () => void) => () => void;
  /** Starts creating the recovery seed in the background, e.g. when the setup form opens. */
  readonly prepareAccount: () => void;
  /**
   * Creates the account, opens it and saves the shop. The recovery seed is
   * offered to the browser's password manager, never shown.
   */
  readonly createAccount: (shop: ShopProfile) => Promise<void>;
  /**
   * Restores the account of a recovery seed. Signed out, it opens in this
   * page; signed in to another account, the app reloads into the restored one.
   */
  readonly restoreAccount: (
    recoverySeed: string,
  ) => Promise<Result.Result<void, InvalidRecoverySeed>>;
  /** Deletes everything stored on this device and reloads to the welcome screen. */
  readonly resetDevice: () => void;
}

/** The browser pieces the device needs; tests pass in-memory ones. */
export interface DevicePlatform {
  readonly kv: KeyValueStorage;
  readonly openStore: (account: Account) => Promise<LinkyStore>;
  readonly servicePorts: (account: Account) => ServicePorts;
  readonly saveRecoverySeed: (account: Account, shopName: string) => void;
  readonly reload: () => void;
  readonly resetDevice: () => void;
}

export const createDevice = (
  config: AppConfig,
  platform: DevicePlatform,
): Device => {
  let session: Session = { _tag: "SignedOut" };
  const listeners = new Set<() => void>();
  const setSession = (next: Session) => {
    session = next;
    for (const listener of listeners) listener();
  };

  const open = async (account: Account, restored: boolean) => {
    setSession({ _tag: "Opening" });
    try {
      const services = createAppServices({
        account,
        store: await platform.openStore(account),
        config,
        ports: platform.servicePorts(account),
      });
      services.start();
      setSession({ _tag: "SignedIn", services, restored });
      return services;
    } catch (error) {
      setSession({ _tag: "SignedOut" });
      throw error;
    }
  };

  let prepared: Promise<Account> | null = null;
  const prepareAccount = () => {
    prepared ??= Effect.runPromise(
      Effect.flatMap(createRecoverySeed, deriveAccount),
    );
    // A failure surfaces when the account is created; preparing again retries.
    prepared.catch(() => {
      prepared = null;
    });
    return prepared;
  };

  /** linkshu's counters and cursors belong to the replaced seed; reused under another one they collide at the mint. */
  const wipeSeedBoundState = (account: Account) =>
    runLinkshu(
      {
        bip39Seed: account.cashuSeed,
        keyValueStore: platform.servicePorts(account).keyValueStore,
      },
      Effect.flatMap(Restore, (restore) => restore.wipeSeedBoundState),
    );

  const stored = loadStoredAccount(platform.kv);
  if (stored !== null) void open(stored, false);

  return {
    session: () => session,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    prepareAccount: () => void prepareAccount(),
    createAccount: async (shop) => {
      if (session._tag !== "SignedOut") return;
      const account = await prepareAccount();
      storeAccount(platform.kv, account);
      const services = await open(account, false);
      await services.shop.save(shop);
      platform.saveRecoverySeed(account, shop.name);
    },
    restoreAccount: async (recoverySeed) => {
      const derived = await Effect.runPromise(
        Effect.result(deriveAccount(recoverySeed)),
      );
      if (Result.isFailure(derived)) return Result.fail(derived.failure);
      const account = derived.success;
      const replaced = loadStoredAccount(platform.kv);
      if (replaced !== null && replaced.npub !== account.npub) {
        if (session._tag === "SignedIn") await session.services.dispose();
        await wipeSeedBoundState(account);
      }
      storeAccount(platform.kv, account);
      markAwaitingFirstHydration(platform.kv, account.appMnemonic);
      if (session._tag === "SignedOut") await open(account, true);
      // Evolu opens once per page, so another account opens after a reload.
      else platform.reload();
      return Result.void;
    },
    resetDevice: platform.resetDevice,
  };
};
