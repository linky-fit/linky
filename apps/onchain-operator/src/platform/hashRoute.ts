import { useSyncExternalStore } from "react";
import { parseRoute, routeHash, type Route } from "../routing";

const subscribe = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};

const currentHash = () => window.location.hash;

export const useRoute = (): Route =>
  parseRoute(useSyncExternalStore(subscribe, currentHash));

export const navigateTo = (route: Route): void => {
  window.location.hash = routeHash(route);
};
