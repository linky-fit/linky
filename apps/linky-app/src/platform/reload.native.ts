import { reloadAppAsync } from "expo";
import { localStorageKv, safeSessionStorageEntries } from "../utils/storage";
import { keepSessionStorageForReload } from "./reloadableSessionStorage";

/** Restarts the JavaScript app from its entry point, keeping sessionStorage as a page reload does. */
export const reloadApp = (): void => {
  keepSessionStorageForReload(localStorageKv, safeSessionStorageEntries());
  void reloadAppAsync();
};
