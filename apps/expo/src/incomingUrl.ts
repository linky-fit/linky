import { readHashLink } from "@linky-fit/linky-app/src/platform/hashLinkReaders";
import { parseNativeDeepLinkUrl } from "@linky-fit/linky-app/src/utils/deepLinks";
import {
  legacyHashTarget,
  routePathForUrl,
  urlPathFor,
  type SpdStore,
} from "./routeUrl";

/** What a URL the OS opens the app with asks for. */
export type IncomingUrl =
  /** A `nostr:`, `cashu:` or `nostrconnect:` link, as text for the scanned-text handler. */
  | { readonly _tag: "ScanText"; readonly text: string }
  /** A command link in a fragment (`#add/…`, `#linkauth…`, `#wallet?cashu=…`). */
  | { readonly _tag: "HashLink"; readonly hash: string }
  /** A route of the app, as the URL path expo-router opens. */
  | { readonly _tag: "Route"; readonly href: string };

const SCAN_SCHEME = /^(nostr|cashu|nostrconnect):/i;
const APP_URL = /^(?:linky:\/*|https:\/\/app\.linky\.fit(?=[/?#]|$))/i;

const splitAt = (value: string, separator: string): [string, string] => {
  const index = value.indexOf(separator);
  return index < 0 ? [value, ""] : [value.slice(0, index), value.slice(index)];
};

/** The path, search and fragment of a `linky:` or app.linky.fit URL; `linky://chat/abc` has the path `/chat/abc`. */
const appLocation = (url: string) => {
  const prefix = APP_URL.exec(url)?.[0];
  if (prefix === undefined) return null;
  const [beforeHash, hash] = splitAt(url.slice(prefix.length), "#");
  const [path, search] = splitAt(beforeHash, "?");
  return { pathname: `/${path.replace(/^\/+/, "")}`, search, hash };
};

/** What `url` asks the app for, or null when it is not a link the app takes, such as the bare `linky://` a plain launch opens. */
export const classifyIncomingUrl = (
  url: string,
  store: SpdStore,
): IncomingUrl | null => {
  if (SCAN_SCHEME.test(url)) {
    const parsed = parseNativeDeepLinkUrl(url);
    return parsed && { _tag: "ScanText", text: parsed.text };
  }
  const location = appLocation(url);
  if (location === null) return null;
  if (location.hash) {
    const target = legacyHashTarget(location.hash, store);
    if (target !== null) return { _tag: "Route", href: target };
    if (readHashLink(location.hash))
      return { _tag: "HashLink", hash: location.hash };
  }
  const routePath = routePathForUrl(location.pathname, location.search, store);
  const href = urlPathFor(routePath, store);
  return href === "/" ? null : { _tag: "Route", href };
};
