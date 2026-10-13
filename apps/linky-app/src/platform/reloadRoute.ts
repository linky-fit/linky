import type { KeyValueStorage } from "@linky-fit/linksync/evolu";

const RELOAD_ROUTE_KEY = "linky.native.reloadRoute";

/** Hands a route path to the app run a reload starts. */
export const keepReloadRoute = (kv: KeyValueStorage, routePath: string): void =>
  kv.setItem(RELOAD_ROUTE_KEY, routePath);

/** The route path the previous run handed over, once. */
export const takeReloadRoute = (kv: KeyValueStorage): string | null => {
  const routePath = kv.getItem(RELOAD_ROUTE_KEY);
  if (routePath !== null) kv.removeItem(RELOAD_ROUTE_KEY);
  return routePath;
};
