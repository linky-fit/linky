// Metro resolves apps/linky-app/src/platform/navigation.ts to this module:
// routes live in the URL path and expo-router navigates.
// navigation.contract.ts keeps the exports in step.
import { ExpoRoot, router, Slot } from "expo-router";
import { ctx } from "expo-router/_ctx";
import { createContext, use, useEffect, useState, type ReactNode } from "react";
import { isDevBuild } from "@linky-fit/linky-app/src/platform/buildEnv.ts";
import {
  safeSessionStorageGet,
  safeSessionStorageSet,
} from "@linky-fit/linky-app/src/utils/storage.ts";
import {
  legacyHashTarget,
  routePathForUrl,
  routerStartUrl,
  urlPathFor,
} from "./routeUrl.ts";
import { useRouterRoutePath } from "./useRouterRoutePath.ts";

const spdStore = { get: safeSessionStorageGet, set: safeSessionStorageSet };

/** The route in the address bar, which follows a router navigation after its render. */
export const currentRoutePath = (): string =>
  routePathForUrl(window.location.pathname, window.location.search, spdStore);

export const useCurrentRoutePath = (): string => useRouterRoutePath(spdStore);

// Set when NavigationRoot first renders. Before that (the launch fragment
// at boot) expo-router has not read the URL; after it, router.push queues
// until the navigator can act.
let routerStarted = false;
// The path and search expo-router starts from.
let startHref: string | null = null;

// Back and forward: expo-router would rebuild its whole tree from history
// it did not record, remounting the shell in the root layout. Listening
// before it (this module loads before the router mounts), the seam takes
// the event and has the router replace its route with the restored URL.
if (typeof window !== "undefined") {
  window.addEventListener("popstate", (event) => {
    if (!routerStarted) return;
    event.stopImmediatePropagation();
    router.replace(`${window.location.pathname}${window.location.search}`);
  });
}

const openUrlPath = (href: string, replace: boolean): void => {
  if (!routerStarted) {
    // At boot (the launch fragment), expo-router has not read the URL yet.
    if (replace) window.history.replaceState(null, "", href);
    else window.history.pushState(null, "", href);
    return;
  }
  if (!replace) {
    router.push(href);
    return;
  }
  // expo-router keeps the fragment on a replace; a command link that called
  // this has read it and wants it gone.
  const { pathname, search } = window.location;
  window.history.replaceState(window.history.state, "", pathname + search);
  router.replace(href);
};

/** Opens a route path in a new history entry, or in place of the current one with `replace`. */
export const navigateToRoutePath = (
  path: string,
  options?: { replace?: boolean },
): void => {
  openUrlPath(urlPathFor(path, spdStore), options?.replace ?? false);
};

/** Reloads the app on a route path, as a restore or an identity switch does once its new session is stored. */
export const reloadAtRoutePath = (path: string): void => {
  // The address bar changes first, so a reload another hook starts in the
  // same turn (the synced identity check) lands on the route too.
  window.history.pushState(null, "", urlPathFor(path, spdStore));
  window.location.reload();
};

/** Leaves the app for another page, such as the site a login came from. */
export const navigateAwayTo = (url: string): void => {
  window.location.assign(url);
};

/** app/+native-intent.tsx: expo-router calls it on iOS and Android only. */
export const redirectSystemPath = ({
  path,
}: {
  readonly path: string;
  readonly initial: boolean;
}): string | null => path;

/** Moves a hash-routed URL (`/#chat/abc`) to its path; command links keep their fragment. */
const redirectLegacyHash = (
  hash: string,
  navigate: (href: string) => void,
): void => {
  const target = legacyHashTarget(hash, spdStore);
  if (target !== null) navigate(target);
};

const AppShell = createContext<ReactNode>(null);

/**
 * app/_layout.tsx: the app shell, rendered once around every route. The
 * shell picks its page from the route; the route files render nothing.
 */
export const RootLayout = (): ReactNode => {
  // React's dev effect replay remounts the Slot, which leaves expo-router
  // writing `/` over the URL it started from; navigating there again puts
  // the deep link back. Production runs effects once.
  useEffect(() => {
    if (isDevBuild && startHref !== null) router.replace(startHref);
  }, []);
  return (
    <>
      {use(AppShell)}
      <Slot />
    </>
  );
};

export const NavigationRoot = ({
  children,
}: {
  readonly children: ReactNode;
}): ReactNode => {
  // expo-router would start from the URL it saw when it loaded.
  const [location] = useState(() => {
    redirectLegacyHash(window.location.hash, (href) =>
      window.history.replaceState(null, "", href),
    );
    routerStarted = true;
    const url = routerStartUrl(window.location.href);
    startHref = `${url.pathname}${url.search}`;
    return url;
  });
  // An open app gets a link as a hash change, not a fresh load.
  useEffect(() => {
    // A navigation that already replaced this fragment wins over it.
    const onHashChange = (event: HashChangeEvent) => {
      const hash = new URL(event.newURL).hash;
      if (window.location.hash !== hash) return;
      redirectLegacyHash(hash, (href) => openUrlPath(href, true));
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  return (
    <AppShell value={children}>
      <ExpoRoot context={ctx} location={location} />
    </AppShell>
  );
};
