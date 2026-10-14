import type { AppConfig } from "../config";
import { createDevice, type Device } from "../services/device";
import { openBrowserStore } from "../storage/evolu.web";
import { reloadApp, resetDevice } from "./deviceWipe";
import { localStorageKeyValueStore } from "./linkshuKeyValueStore";
import { linkstrStores } from "./linkstrStores";
import { onOnline } from "./online";
import { saveRecoverySeedToPasswordManager } from "./passwordManager";
import { deferUpdateWhile } from "./pwaUpdate";
import { localStorageKv } from "./storage";

/** The device over the browser: Evolu in OPFS, secrets and queues in localStorage. */
export const createBrowserDevice = (config: AppConfig): Device =>
  createDevice(config, {
    kv: localStorageKv,
    openStore: (account) => openBrowserStore(account, config),
    servicePorts: (account) => ({
      ...linkstrStores(account.pubkey),
      keyValueStore: localStorageKeyValueStore,
      onOnline,
      deferUpdateWhile,
    }),
    saveRecoverySeed: (account, shopName) =>
      void saveRecoverySeedToPasswordManager(account, shopName),
    reload: reloadApp,
    resetDevice,
  });
