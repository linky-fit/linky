import { readNotificationOpenHashLink } from "../app/lib/notificationOpenTarget";
import { extractCashuTokenFromText } from "../app/lib/tokenText";
import { readAddContactNpubFromHash } from "../sharedProfileLink";
import { readSiteLoginHashLink } from "../siteLogin";

/** A link a fragment carries, and the route the app shows once it is taken. */
export interface HashLink {
  readonly link: string;
  readonly routePath: string;
}

export type HashLinkReader = (hash: string) => HashLink | null;

const routePathOfHash = (hash: string): string =>
  hash.slice(1).split("?")[0] ?? "";

/** Site login and Cashu links, as text for the scanned-text handler. */
export const readScanHashLink: HashLinkReader = (hash) => {
  const siteLogin = readSiteLoginHashLink(hash);
  if (siteLogin) return { link: siteLogin, routePath: "wallet" };
  // `#wallet?cashu=…`: the manifest's web+cashu protocol handler.
  const token = extractCashuTokenFromText(hash);
  return token
    ? { link: `cashu:${token}`, routePath: routePathOfHash(hash) }
    : null;
};

/** `?notificationOpen=` details from a notification tap. */
export const readNotificationOpen: HashLinkReader = (hash) => {
  const taken = readNotificationOpenHashLink(hash);
  return taken && { link: taken.detail, routePath: taken.routePath };
};

/** `#add/<npub>` profile links from linky.fit, as the npub. */
export const readAddContact: HashLinkReader = (hash) => {
  const npub = readAddContactNpubFromHash(hash);
  return npub ? { link: npub, routePath: "contacts" } : null;
};

const readers = [readScanHashLink, readNotificationOpen, readAddContact];

/** The link a fragment carries, whichever kind it is. */
export const readHashLink = (hash: string): HashLink | null =>
  readers.map((read) => read(hash)).find((link) => link) ?? null;
