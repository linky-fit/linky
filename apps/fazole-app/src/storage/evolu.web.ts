import { createEvoluDeps, createRun } from "@evolu/web";
import { linkyScopes, type LinkyStore } from "@linky-fit/linksync";
import {
  makeEvoluRelaySettings,
  openLinkyDatabase,
} from "@linky-fit/linksync/evolu";
import type { AppConfig } from "../config";
import { reloadApp } from "../platform/deviceWipe";
import { localStorageKv } from "../platform/storage";
import type { Account } from "./account";

/** The Evolu relays this device syncs through. */
export const activeEvoluRelayUrls = (
  config: AppConfig,
): ReadonlyArray<string> =>
  makeEvoluRelaySettings(localStorageKv, {
    envDefaults: config.evoluRelayDefaults,
    recommended: config.recommendedEvoluRelays,
    hasStoredAccount: false,
  }).activeUrls();

/**
 * Opens the account's sharded Evolu database in this page; the first time,
 * Evolu moves this origin's Evolu 7 database in. Rejects promptly when another
 * tab holds the database or persistent storage is unavailable. Call it once per
 * page load.
 */
export const openBrowserStore = (
  account: Account,
  config: AppConfig,
): Promise<LinkyStore> =>
  openLinkyDatabase(createRun(createEvoluDeps()), {
    mnemonic: account.appMnemonic,
    kv: localStorageKv,
    envDefaults: config.evoluRelayDefaults,
    recommended: config.recommendedEvoluRelays,
    scopes: linkyScopes,
    hasStoredAccount: false,
    onDatabaseDeleted: reloadApp,
  });
