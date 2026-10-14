// Metro resolves apps/linky-app/src/platform/navigation.ts to this module on
// iOS and Android: expo-router keeps the route and navigates.
import { reportAppLog } from "@linky-fit/linky-app/src/devtools/inspector/appLog";
import {
  receiveHashLink,
  receiveScanText,
} from "@linky-fit/linky-app/src/platform/hashLinks.native";
import { HANDLED_LAUNCH_URL_KEY } from "@linky-fit/linky-app/src/platform/reloadableSessionStorage";
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
import { classifyIncomingUrl, type IncomingUrl } from "./incomingUrl";
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

/** Hands the link over and returns the URL path it opens, or null to stay. */
const openIncoming = (incoming: IncomingUrl): string | null => {
  switch (incoming._tag) {
    case "ScanText":
      receiveScanText(incoming.text);
      return null;
    case "HashLink": {
      const routePath = receiveHashLink(incoming.hash);
      return routePath === null ? null : urlPathFor(routePath, spdStore);
    }
    case "Route":
      return incoming.href;
  }
};

/** Logs a URL the OS opened the app with, hands its link over and returns the URL path it opens, or null to stay. */
const takeIncomingUrl = (path: string, initial: boolean): string | null => {
  const incoming = classifyIncomingUrl(path, spdStore);
  if (incoming === null) return null;
  reportAppLog({
    tag: "navigation.incomingLink",
    summary: `The system opened the app with a ${incoming._tag} link`,
    payload: { kind: incoming._tag, initial },
  });
  return openIncoming(incoming);
};

/**
 * app/+native-intent.tsx: expo-router passes every URL the OS opens the app
 * with here, the launch URL with `initial`, whose returned path becomes the
 * first route. A later link replaces the route like any in-app navigation:
 * a returned path would be pushed, and the router's own back handler would
 * then pop back to the page the link interrupted. Links go to their
 * subscribers in hashLinks.native.ts, which hand each one over once.
 */
export const redirectSystemPath = ({
  path,
  initial,
}: {
  readonly path: string;
  readonly initial: boolean;
}): string | null => {
  if (initial) {
    // A reload restarts JavaScript with the same launch URL, whose link the previous run took.
    if (safeSessionStorageGet(HANDLED_LAUNCH_URL_KEY) === path) return "/";
    safeSessionStorageSet(HANDLED_LAUNCH_URL_KEY, path);
    return takeIncomingUrl(path, true) ?? "/";
  }
  const href = takeIncomingUrl(path, false);
  if (href !== null) openHref(href);
  return null;
};

// React Native drops a link the OS hands over while nothing listens, and
// expo-router listens only once it mounts, after the session boots.
let linksBeforeRouter: string[] = [];
const bootLinkListener = Linking.addEventListener("url", ({ url }) => {
  linksBeforeRouter = [...linksBeforeRouter, url];
});

/** Hands the links that arrived during boot over as the router would have. */
const takeLinksBeforeRouter = (): string | null => {
  bootLinkListener.remove();
  const links = linksBeforeRouter;
  linksBeforeRouter = [];
  return links.reduce<string | null>(
    (href, path) => takeIncomingUrl(path, false) ?? href,
    null,
  );
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
    const linkHref = takeLinksBeforeRouter();
    const start =
      reloadRoute === null
        ? (linkHref ?? pendingHref)
        : urlPathFor(reloadRoute, spdStore);
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
