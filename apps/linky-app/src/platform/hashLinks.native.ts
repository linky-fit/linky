import {
  readAddContact,
  readNotificationOpen,
  readScanHashLink,
  type HashLinkReader,
} from "./hashLinkReaders";

// The OS hands links to the app through expo-router's redirectSystemPath
// (src/navigation.native.tsx), which passes them here.

type LinkKind = "scan" | "notificationOpen" | "addContact";

const readers: ReadonlyArray<readonly [LinkKind, HashLinkReader]> = [
  ["scan", readScanHashLink],
  ["notificationOpen", readNotificationOpen],
  ["addContact", readAddContact],
];

const subscribers: Record<LinkKind, Set<(link: string) => void>> = {
  scan: new Set(),
  notificationOpen: new Set(),
  addContact: new Set(),
};

// Links that arrived while nothing of their kind subscribed, oldest first.
let waiting: ReadonlyArray<{ readonly kind: LinkKind; readonly link: string }> =
  [];

const deliver = (kind: LinkKind, link: string): void => {
  if (subscribers[kind].size === 0) {
    waiting = [...waiting, { kind, link }];
    return;
  }
  for (const onLink of subscribers[kind]) onLink(link);
};

/**
 * Hands the link a fragment carries to the subscribers of its kind, or to
 * the first one that subscribes. Returns the route the app shows for it,
 * or null when the fragment carries no link.
 */
export const receiveHashLink = (hash: string): string | null => {
  for (const [kind, read] of readers) {
    const taken = read(hash);
    if (!taken) continue;
    deliver(kind, taken.link);
    return taken.routePath;
  }
  return null;
};

/** Hands a `nostr:`, `cashu:` or `nostrconnect:` link to the scanned-text handler. */
export const receiveScanText = (text: string): void => deliver("scan", text);

const subscribe =
  (kind: LinkKind) =>
  (onLink: (link: string) => void): (() => void) => {
    const taken = waiting.filter((item) => item.kind === kind);
    waiting = waiting.filter((item) => item.kind !== kind);
    for (const item of taken) onLink(item.link);
    subscribers[kind].add(onLink);
    return () => subscribers[kind].delete(onLink);
  };

/** The OS hands launch links to receiveHashLink instead. */
export const captureLaunchHashLink = (): void => {};

/** Site login, Cashu and Nostr links, as text for the scanned-text handler. */
export const subscribeScanHashLinks = subscribe("scan");

/** `?notificationOpen=` details from a notification tap. */
export const subscribeNotificationOpenHashLinks = subscribe("notificationOpen");

/** `#add/<npub>` profile links from linky.fit, as the npub. */
export const subscribeAddContactHashLinks = subscribe("addContact");
