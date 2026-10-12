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

const routePathOfUrl = (url: URL): string =>
  pathRouting ? `${url.pathname.slice(1)}${url.search}` : url.hash.slice(1);

export const routePathOf = (page: Page): string =>
  routePathOfUrl(new URL(page.url()));

export const gotoRoute = async (page: Page, routePath: string) =>
  page.goto(routeUrl(routePath));

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
