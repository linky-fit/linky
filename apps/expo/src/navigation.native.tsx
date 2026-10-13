// Metro resolves apps/linky-app/src/platform/navigation.ts to this module on
// iOS and Android: expo-router keeps the route and navigates.
import { restartAppAt } from "@linky-fit/linky-app/src/platform/restartApp.native";
import { takeReloadRoute } from "@linky-fit/linky-app/src/platform/reloadRoute";
import {
  localStorageKv,
  safeSessionStorageGet,
  safeSessionStorageSet,
} from "@linky-fit/linky-app/src/utils/storage";
import { ExpoRoot, router, Slot } from "expo-router";
import { ctx } from "expo-router/_ctx";
import { createContext, use, useEffect, type ReactNode } from "react";
import { Linking } from "react-native";
import { urlPathFor } from "./routeUrl";
import { useRouterRoutePath } from "./useRouterRoutePath";

const spdStore = { get: safeSessionStorageGet, set: safeSessionStorageSet };

// The route the router last rendered; the wallet until it first renders.
let routePath = "";
// A navigation asked for before the router mounted, opened once it has.
let pendingHref: string | null = null;
let routerMounted = false;

/** The route the router last rendered. */
export const currentRoutePath = (): string => routePath;

export const useCurrentRoutePath = (): string => useRouterRoutePath(spdStore);

// Back walks up the route hierarchy (useNativeBackHandler), never through
// history, so the router keeps one entry and its own back handler, which
// would pop that history, never claims a press.
const openHref = (href: string): void => {
  if (routerMounted) router.replace(href);
  else pendingHref = href;
};

/** Opens a route path in place of the current one. */
export const navigateToRoutePath = (path: string): void =>
  openHref(urlPathFor(path, spdStore));

/** Reloads the app on a route path, as a restore or an identity switch does once its new session is stored. */
export const reloadAtRoutePath = (path: string): void => restartAppAt(path);

/** Leaves the app for another app or the browser, such as the site a login came from. */
export const navigateAwayTo = (url: string): void => {
  void Linking.openURL(url);
};

const AppShell = createContext<ReactNode>(null);

/**
 * app/_layout.tsx: the app shell, rendered once around every route. The
 * shell picks its page from the route; the route files render nothing.
 */
export const RootLayout = (): ReactNode => {
  const path = useCurrentRoutePath();
  useEffect(() => {
    routePath = path;
  }, [path]);
  useEffect(() => {
    routerMounted = true;
    const reloadRoute = takeReloadRoute(localStorageKv);
    const start =
      reloadRoute === null ? pendingHref : urlPathFor(reloadRoute, spdStore);
    pendingHref = null;
    if (start !== null) openHref(start);
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
}): ReactNode => (
  <AppShell value={children}>
    <ExpoRoot context={ctx} />
  </AppShell>
);
