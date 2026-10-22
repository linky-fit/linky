import { createSharedWebWorker, evoluWebDeps } from "@evolu/web";
import { linkyScopes, type LinkyStore } from "@linky-fit/linksync";
import {
  createLinkyEvolu,
  makeEvoluRelaySettings,
  openLinkyStore,
} from "@linky-fit/linksync/evolu";
import { flushSync } from "react-dom";
import type { AppConfig } from "../config";
import { localStorageKv } from "../platform/storage";
import type { Account } from "./account";

/**
 * Opens the account's sharded Evolu database in this page, over a database
 * worker built on linksync's owner-sync worker. Evolu cannot be closed, so
 * call it once per page load.
 */
export const openBrowserStore = (
  account: Account,
  config: AppConfig,
): Promise<LinkyStore> => {
  const relays = makeEvoluRelaySettings(localStorageKv, {
    envDefaults: config.evoluRelayDefaults,
    recommended: config.recommendedEvoluRelays,
    hasStoredAccount: false,
  });
  const transports = relays
    .activeUrls()
    .map((url) => ({ type: "WebSocket" as const, url }));
  const { evolu, ownerSync } = createLinkyEvolu({
    evoluDeps: { ...evoluWebDeps, flushSync },
    createWorker: (name) =>
      createSharedWebWorker(
        name,
        () =>
          new Worker(new URL("../evoluDb.worker.ts", import.meta.url), {
            type: "module",
          }),
      ),
    mnemonic: account.appMnemonic,
    transports,
    inMemory: false,
    enableLogging: false,
  });
  return openLinkyStore(evolu, ownerSync, {
    kv: localStorageKv,
    scopes: linkyScopes,
    hasEvoluRelay: transports.length > 0,
  });
};
