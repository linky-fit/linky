import { createEvoluDeps, createRun } from "@evolu/web";
import { linkyScopes, type LinkyStore } from "@linky-fit/linksync";
import {
  makeEvoluRelaySettings,
  openLinkyEvolu,
  openLinkyStore,
} from "@linky-fit/linksync/evolu";
import type { AppConfig } from "../config";
import { localStorageKv } from "../platform/storage";
import type { Account } from "./account";

/**
 * Opens the account's sharded Evolu database in this page; the first time,
 * Evolu moves this origin's Evolu 7 database in. Call it once per page load.
 */
export const openBrowserStore = async (
  account: Account,
  config: AppConfig,
): Promise<LinkyStore> => {
  const relayUrls = makeEvoluRelaySettings(localStorageKv, {
    envDefaults: config.evoluRelayDefaults,
    recommended: config.recommendedEvoluRelays,
    hasStoredAccount: false,
  }).activeUrls();
  const run = createRun(createEvoluDeps());
  const evolu = await openLinkyEvolu(run, {
    mnemonic: account.appMnemonic,
    relayUrls,
    memoryOnly: false,
  });
  return openLinkyStore(evolu, {
    syncState: run.deps.syncState,
    kv: localStorageKv,
    scopes: linkyScopes,
    hasEvoluRelay: relayUrls.length > 0,
  });
};
