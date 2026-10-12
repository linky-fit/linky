import { expect, type Page } from "@playwright/test";

/**
 * Route URLs in the form the app under test uses: `/#chat/abc` for the Vite
 * app, `/chat/abc` with `LINKY_E2E_ROUTING=path` (the Expo app). A route path
 * is the route without `#` or a leading `/`. Command links (`#add/…`,
 * `#linkauth…`, `#nostrconnect…`, `#wallet?cashu=…`) stay raw fragments.
 */
const pathRouting = process.env.LINKY_E2E_ROUTING === "path";

export const routeUrl = (routePath: string): string =>
  pathRouting ? `/${routePath}` : `/#${routePath}`;

// The router may leave characters such as `:` unescaped; route paths encode
// each segment as routePathFor does.
const canonicalPath = (pathname: string): string =>
  pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(decodeURIComponent(segment)))
    .join("/");

const routePathOfUrl = (url: URL): string =>
  pathRouting
    ? `${canonicalPath(url.pathname)}${url.search}`
    : url.hash.slice(1);

export const routePathOf = (page: Page): string =>
  routePathOfUrl(new URL(page.url()));

/**
 * Opens a route. A page already showing the app changes route without a
 * reload, as a hash change does, so app state and the load count survive.
 */
export const gotoRoute = async (
  page: Page,
  routePath: string,
): Promise<void> => {
  const url = routeUrl(routePath);
  if (!pathRouting || !page.url().startsWith("http")) {
    await page.goto(url);
    return;
  }
  await page.evaluate((target) => {
    window.history.pushState(null, "", target);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, url);
};

const matches = (routePath: string, pattern: string | RegExp): boolean =>
  typeof pattern === "string" ? routePath === pattern : pattern.test(routePath);

/** Asserts the route path equals `pattern`, or matches it as a RegExp. */
export const expectRoute = async (
  page: Page,
  pattern: string | RegExp,
  options?: { timeout?: number },
): Promise<void> => {
  const poll = expect.poll(() => routePathOf(page), options);
  await (typeof pattern === "string"
    ? poll.toBe(pattern)
    : poll.toMatch(pattern));
};

/** page.waitForURL for a route path. */
export const waitForRoute = async (
  page: Page,
  pattern: string | RegExp,
  options?: { timeout?: number },
): Promise<void> =>
  page.waitForURL((url) => matches(routePathOfUrl(url), pattern), options);
