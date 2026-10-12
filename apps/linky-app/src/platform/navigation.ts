import { useSyncExternalStore, type ReactNode } from "react";

/**
 * The routing seam: the web app keeps its route in the URL hash
 * (`#chat/abc`). A route path is that route without `#` or a leading `/`,
 * query included: `chat/abc`, `wallet/recurring/new?contact=x`.
 */

// replaceState fires no hashchange, so a replaced route notifies these itself.
const replaceListeners = new Set<() => void>();

const subscribe = (onChange: () => void): (() => void) => {
  replaceListeners.add(onChange);
  window.addEventListener("hashchange", onChange);
  return () => {
    replaceListeners.delete(onChange);
    window.removeEventListener("hashchange", onChange);
  };
};

export const currentRoutePath = (): string => {
  const hash = globalThis.location?.hash ?? "";
  const href = globalThis.location?.href ?? "";
  // An empty fragment (`/#`, `/#?…`, read as "" without a query) opens
  // contacts; no fragment at all opens the wallet.
  if (hash.startsWith("#?") || (hash === "" && href.endsWith("#"))) {
    return `contacts${hash.slice(1)}`;
  }
  return hash.slice(1);
};

export const useCurrentRoutePath = (): string =>
  useSyncExternalStore(subscribe, currentRoutePath);

/** Opens a route path in a new history entry, or in place of the current one with `replace`. */
export const navigateToRoutePath = (
  path: string,
  options?: { replace?: boolean },
): void => {
  if (!options?.replace) {
    window.location.assign(`#${path}`);
    return;
  }
  const { pathname, search } = window.location;
  window.history.replaceState(null, "", `${pathname}${search}#${path}`);
  for (const listener of replaceListeners) listener();
};

/** Leaves the app for another page, such as the site a login came from. */
export const navigateAwayTo = (url: string): void => {
  window.location.assign(url);
};

/** Wraps the app shell in what the router needs; hash routing needs nothing. */
export const NavigationRoot = ({
  children,
}: {
  readonly children: ReactNode;
}): ReactNode => children;
