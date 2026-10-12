import { Option, Schema } from "effect";
import {
  BANK_PAYMENT_EDIT_SUFFIX,
  parseRoutePath,
  routePathFromLegacyHash,
} from "@linky-fit/linky-app/src/types/route.ts";

/** Where bank payment details wait for the route that shows them. */
export interface SpdStore {
  readonly get: (key: string) => string | null;
  readonly set: (key: string, value: string) => void;
}

// A bank payment route holds a SPAYD (account, amount, message). The URL
// carries a short id instead, and the payload stays in the tab's
// sessionStorage, which survives a reload but never reaches a server.
const SPD_STORE_KEY = "linky.bank_payment_spd.v1";
const BANK_PAYMENT_PREFIX = "wallet/bank-payment/";
const SPD_ID_PATH = /^wallet\/bank-payment\/(spd-[0-9a-f]+)(\/edit)?$/;

const decodeSpds = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)),
);

const readSpds = (store: SpdStore): Record<string, string> =>
  Option.getOrElse(decodeSpds(store.get(SPD_STORE_KEY)), () => ({}));

const spdIdFor = (store: SpdStore, payload: string): string => {
  const spds = readSpds(store);
  const known = Object.keys(spds).find((id) => spds[id] === payload);
  if (known) return known;
  const id = `spd-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  store.set(SPD_STORE_KEY, JSON.stringify({ ...spds, [id]: payload }));
  return id;
};

/**
 * The URL path (with its leading `/`) for a route path. Anything that is not
 * a known route opens `/`, so a command link's payload never becomes a path.
 */
export const urlPathFor = (routePath: string, store: SpdStore): string => {
  const route = parseRoutePath(routePath);
  if (route.kind === "bankPayment") {
    const id = spdIdFor(store, route.spdPayload);
    return `/${BANK_PAYMENT_PREFIX}${id}${route.editing ? BANK_PAYMENT_EDIT_SUFFIX : ""}`;
  }
  return `/${routePathFromLegacyHash(routePath) ?? ""}`;
};

const decodeSegment = (segment: string): string => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

/** A URL pathname's segments, decoded. */
const pathSegments = (pathname: string): string[] =>
  pathname.split("/").filter(Boolean).map(decodeSegment);

/**
 * The route path a URL's pathname and search stand for. Segments are
 * re-encoded as routePathFor encodes them, since expo-router writes
 * characters such as `:` unescaped.
 */
export const routePathForUrl = (
  pathname: string,
  search: string,
  store: SpdStore,
): string => {
  const path = pathSegments(pathname).map(encodeURIComponent).join("/");
  const spd = SPD_ID_PATH.exec(path);
  if (!spd) return `${path}${search}`;
  const payload = readSpds(store)[spd[1] ?? ""];
  // Another tab or a shared link has no payload to show.
  if (payload === undefined) return "wallet";
  return `${BANK_PAYMENT_PREFIX}${encodeURIComponent(payload)}${spd[2] ?? ""}`;
};

/**
 * Where a hash URL from the hash-routed app now lives, or null to leave the
 * fragment to its command-link handler (`#add/…`, `#linkauth…`, `?cashu=`).
 */
export const legacyHashTarget = (
  hash: string,
  store: SpdStore,
): string | null => {
  const routePath = hash.replace(/^#/, "");
  if (parseRoutePath(routePath).kind === "bankPayment")
    return urlPathFor(routePath, store);
  const target = routePathFromLegacyHash(hash);
  return target === null ? null : `/${target}`;
};

/**
 * The URL expo-router starts from: the current one without its fragment. A
 * fragment left here is a command link its handler takes and clears, and
 * expo-router would write it back to the address bar when it replays its
 * first navigation (React's dev effect replay does), handing the link over
 * twice.
 */
export const routerStartUrl = (href: string): URL => {
  const url = new URL(href);
  url.hash = "";
  return url;
};
