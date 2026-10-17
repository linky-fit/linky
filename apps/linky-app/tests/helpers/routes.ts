import { expect, type Page } from "@playwright/test";
import "./linkyHooks";

/**
 * Route URLs in the form the app under test uses: `/#chat/abc` for the Vite
 * app, `/chat/abc` with `LINKY_E2E_ROUTING=path` (the Expo app). A route path
 * is the route without `#` or a leading `/`. Command links (`#add/…`,
 * `#linkauth…`, `#nostrconnect…`, `#wallet?cashu=…`) stay raw fragments.
 */
const pathRouting = process.env.LINKY_E2E_ROUTING === "path";

// The Expo app writes a route segment's `%` as `~` (a literal `~` as `~~`),
// so no router decoding splits an encoded `/` (apps/expo/src/routeUrl.ts).
const toUrlSegment = (segment: string): string =>
  segment.replaceAll("~", "~~").replaceAll("%", "~");
const fromUrlSegment = (segment: string): string =>
  segment.replace(/~(~|[0-9A-Fa-f]{2})/g, (_escape, code: string) =>
    code === "~" ? "~" : `%${code}`,
  );

const pathUrl = (routePath: string): string => {
  const [path = "", query] = routePath.split(/\?(.*)/s);
  const segments = path.split("/").map(toUrlSegment).join("/");
  return query === undefined ? `/${segments}` : `/${segments}?${query}`;
};

export const routeUrl = (routePath: string): string =>
  pathRouting ? pathUrl(routePath) : `/#${routePath}`;

const routePathOfUrl = (url: URL): string =>
  pathRouting
    ? `${url.pathname.split("/").filter(Boolean).map(fromUrlSegment).join("/")}${url.search}`
    : url.hash.slice(1);

export const routePathOf = (page: Page): string =>
  routePathOfUrl(new URL(page.url()));

/**
 * Opens a route. A page already showing the app changes route without a
 * reload, as a hash change does, so app state and the load count survive:
 * the path-routed app navigates through its own router, as a tap would.
 */
export const gotoRoute = async (
  page: Page,
  routePath: string,
): Promise<void> => {
  if (!pathRouting || !page.url().startsWith("http")) {
    await page.goto(routeUrl(routePath));
    return;
  }
  // After a reload the hooks arrive once boot has loaded the app modules.
  await page.waitForFunction(() => window.__linkyE2E !== undefined);
  const before = routePathOf(page);
  await page.evaluate((path) => {
    if (!window.__linkyE2E) throw new Error("test hooks missing");
    window.__linkyE2E.navigate(path);
  }, routePath);
  // The router commits after a render; wait until the address bar moved.
  if (before !== routePath) {
    await expect.poll(() => routePathOf(page)).not.toBe(before);
  }
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
