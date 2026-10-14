import { useSyncExternalStore } from "react";
import { parseRoute, routeHash, type Route } from "../routing";

const subscribe = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};

export const useRoute = (): Route =>
  useSyncExternalStore(subscribe, () => parseRoute(window.location.hash));

export const navigateTo = (route: Route): void => {
  window.location.hash = routeHash(route);
};

/** Swaps the current history entry, so Back skips a route that redirected. */
export const replaceRoute = (route: Route): void => {
  window.location.replace(routeHash(route));
};
