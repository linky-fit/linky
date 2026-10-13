import { reloadAppAsync } from "expo";
import { localStorageKv, safeSessionStorageEntries } from "../utils/storage";
import { keepReloadRoute } from "./reloadRoute";
import { keepSessionStorageForReload } from "./reloadableSessionStorage";

/** Restarts the JavaScript app on `routePath`, keeping sessionStorage as a page reload does. */
export const restartAppAt = (routePath: string): void => {
  keepReloadRoute(localStorageKv, routePath);
  keepSessionStorageForReload(localStorageKv, safeSessionStorageEntries());
  void reloadAppAsync();
};
