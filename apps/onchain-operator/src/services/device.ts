import { Restore, runLinkshu } from "@linky-fit/linkshu";
import type { LinkyStore } from "@linky-fit/linksync";
import {
  classifyEvoluOpenError,
  markAwaitingFirstHydration,
  type EvoluOpenFailureReason,
  type KeyValueStorage,
} from "@linky-fit/linksync/evolu";
import { Effect, Result } from "effect";
import type { AppConfig } from "../config";
import {
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

/** Why the device could not open its database. */
export type OpenFailureReason = EvoluOpenFailureReason;

/** Where this device stands with the operator's account. */
export type Session =
  | { readonly _tag: "SignedOut" }
  /** The account is being restored, or its database is opening. */
  | { readonly _tag: "Opening" }
  /** The database could not open (e.g. held by another tab or unavailable storage). */
  | { readonly _tag: "Failed"; readonly reason: OpenFailureReason }
  | { readonly _tag: "SignedIn"; readonly services: AppServices };

/** This device's account lifecycle: restore and reset. */
export interface Device {
  readonly session: () => Session;
  readonly subscribe: (listener: () => void) => () => void;
  /**
   * Restores the account of a Linky recovery seed. Signed out, it opens in
   * this page; signed in to another account, the app reloads into the restored one.
   */
  readonly restoreAccount: (
    recoverySeed: string,
  ) => Promise<Result.Result<void, InvalidRecoverySeed>>;
  /** Reloads the app, e.g. after closing another tab that held the database. */
  readonly reload: () => void;
  /** Deletes everything stored on this device and reloads to the restore screen. */
  readonly resetDevice: () => void;
}

/** The browser pieces the device needs; tests pass in-memory ones. */
export interface DevicePlatform {
  readonly kv: KeyValueStorage;
  readonly openStore: (account: Account) => Promise<LinkyStore>;
  readonly servicePorts: (account: Account) => ServicePorts;
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

  const open = async (account: Account) => {
    setSession({ _tag: "Opening" });
    try {
      const services = createAppServices({
        account,
        store: await platform.openStore(account),
        config,
        ports: platform.servicePorts(account),
      });
      services.start();
      setSession({ _tag: "SignedIn", services });
    } catch (error) {
      setSession({ _tag: "Failed", reason: classifyEvoluOpenError(error) });
      throw error;
    }
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
  if (stored !== null) {
    void open(stored).catch((error: unknown) => {
      console.warn("[onchain-operator] could not open local database", error);
    });
  }

  return {
    session: () => session,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
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
      if (session._tag === "SignedOut") await open(account);
      // Evolu opens once per page, so another account opens after a reload.
      else platform.reload();
      return Result.void;
    },
    reload: platform.reload,
    resetDevice: platform.resetDevice,
  };
};
