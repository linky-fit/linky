/** The main sections; every one but the terminal shows the navigation. */
export const sections = ["terminal", "history", "wallet", "settings"] as const;
export type Section = (typeof sections)[number];

/** Full-screen steps of getting an account onto this device. */
export const flows = ["welcome", "setup", "restore", "restoring"] as const;
export type Flow = (typeof flows)[number];

/** A payment shown to the customer. */
export type PaymentRoute = `pay/${string}`;

/** The chat with Fazole support, opened from the settings. */
export const supportRoute = "support";

export type Route = Section | Flow | PaymentRoute | typeof supportRoute;

/** Where this device stands, as far as routing cares. */
export type AccountState =
  | "signedOut"
  /** The account's database is opening, or its shop is being read. */
  | "opening"
  /** A restored account whose data has not arrived from a relay yet. */
  | "syncing"
  /** The account is in sync and has no shop, e.g. a Linky account restored here. */
  | "noShop"
  | "ready";

const isOneOf = <T extends string>(
  values: readonly T[],
  value: string,
): value is T => values.some((item) => item === value);

const isPaymentRoute = (value: string): value is PaymentRoute =>
  /^pay\/[\w-]+$/u.test(value);

export const parseRoute = (hash: string): Route => {
  const name = hash.replace(/^#\/?/u, "");
  return isOneOf(sections, name) ||
    isOneOf(flows, name) ||
    isPaymentRoute(name) ||
    name === supportRoute
    ? name
    : "welcome";
};

export const routeHash = (route: Route): string => `#${route}`;

export const paymentRoute = (paymentId: string): PaymentRoute =>
  `pay/${paymentId}`;

export const paymentIdOf = (route: Route): string | null =>
  isPaymentRoute(route) ? route.slice("pay/".length) : null;

export const isSection = (route: Route): route is Section =>
  isOneOf(sections, route);

/**
 * Where a route lands in this account state: signed out only the welcome
 * flows open, a restore waits on the restoring screen, an account without a
 * shop sets one up, and a shop opens its sections, payments and the support
 * chat; another account is restored only after the device is reset.
 */
export const resolveRoute = (route: Route, state: AccountState): Route => {
  switch (state) {
    case "signedOut":
      return route === "setup" || route === "restore" ? route : "welcome";
    case "opening":
      return route;
    case "syncing":
      // A shop being set up is saved before the account's first sync lands.
      return route === "setup" ? "setup" : "restoring";
    case "noShop":
      return "setup";
    case "ready":
      return route === supportRoute || isPaymentRoute(route) || isSection(route)
        ? route
        : "terminal";
  }
};
