// Metro resolves apps/linky-app/src/platform/navigation.ts to this module:
// routes live in the URL path through expo-router instead of the hash.
// navigation.contract.ts keeps the exports in step.
import { ExpoRoot } from "expo-router";
import { ctx } from "expo-router/_ctx";
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  safeSessionStorageGet,
  safeSessionStorageSet,
} from "@linky-fit/linky-app/src/utils/storage.ts";
import { legacyHashTarget, routePathForUrl, urlPathFor } from "./routeUrl.ts";

const spdStore = { get: safeSessionStorageGet, set: safeSessionStorageSet };

export const currentRoutePath = (): string =>
  routePathForUrl(window.location.pathname, window.location.search, spdStore);

const subscribe = (onChange: () => void): (() => void) => {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
};

export const useCurrentRoutePath = (): string =>
  useSyncExternalStore(subscribe, currentRoutePath);

/** Opens a route path in a new history entry, or in place of the current one with `replace`. */
export const navigateToRoutePath = (
  path: string,
  options?: { replace?: boolean },
): void => {
  openUrlPath(urlPathFor(path, spdStore), options?.replace ?? false);
};

// The seam writes the URL itself, now, as a hash change does: callers read
// the route back or reload right after, and expo-router's own URL writer
// splits an encoded `/` inside a segment (mint and relay URLs). The popstate
// tells useCurrentRoutePath, and expo-router reads the new URL as it does
// after back or forward.
const openUrlPath = (href: string, replace: boolean): void => {
  if (replace) window.history.replaceState(null, "", href);
  else window.history.pushState(null, "", href);
  window.dispatchEvent(new PopStateEvent("popstate"));
};

/** Leaves the app for another page, such as the site a login came from. */
export const navigateAwayTo = (url: string): void => {
  window.location.assign(url);
};

/** Moves a hash-routed URL (`/#chat/abc`) to its path; command links keep their fragment. */
const redirectLegacyHash = (navigate: (href: string) => void): void => {
  const target = legacyHashTarget(window.location.hash, spdStore);
  if (target !== null) navigate(target);
};

export const NavigationRoot = ({
  children,
}: {
  readonly children: ReactNode;
}): ReactNode => {
  // expo-router would start from the URL it saw when it loaded.
  const [location] = useState(() => {
    redirectLegacyHash((href) => window.history.replaceState(null, "", href));
    return new URL(window.location.href);
  });
  // An open app gets a link as a hash change, not a fresh load.
  useEffect(() => {
    const onHashChange = () =>
      redirectLegacyHash((href) => openUrlPath(href, true));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  // The shell stays outside the router: expo-router rebuilds its route tree
  // for every history entry it did not create, which would remount the app.
  return (
    <>
      {children}
      <ExpoRoot context={ctx} location={location} />
    </>
  );
};
