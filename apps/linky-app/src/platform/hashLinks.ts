import {
  readAddContact,
  readHashLink,
  readNotificationOpen,
  readScanHashLink,
  type HashLinkReader,
} from "./hashLinkReaders";
import { navigateToRoutePath } from "./navigation";

// The fragment the page loaded with, kept for the first subscriber that
// reads a link from it.
let launchHash: string | null = null;

/**
 * Takes the fragment the page loaded with out of the address bar, once, at
 * boot. It runs before the app renders: the subscribers mount later, and by
 * then the URL may have been rewritten (expo-router replaces it as it
 * starts). Its link waits for the first subscriber of its kind.
 */
export const captureLaunchHashLink = (): void => {
  const { hash } = window.location;
  const taken = readHashLink(hash);
  if (!taken) return;
  launchHash = hash;
  navigateToRoutePath(taken.routePath, { replace: true });
};

/**
 * Hands every link of one kind to `onLink`: the launch link, then each later
 * hash change, which is how an open app receives a web link.
 *
 * A hash change is read from its event, not from the address bar: by the
 * time the event runs, a navigation may already have replaced the fragment
 * (a receive that ends on the wallet), and the link must still arrive. The
 * fragment is cleared right away, and only while it is still the current
 * one, so a later route or link is never wiped.
 */
const subscribeHashLink = (
  read: HashLinkReader,
  onLink: (link: string) => void,
): (() => void) => {
  const launch = launchHash === null ? null : read(launchHash);
  if (launch) {
    launchHash = null;
    onLink(launch.link);
  }
  const onHashChange = (event: HashChangeEvent) => {
    const hash = new URL(event.newURL).hash;
    const taken = read(hash);
    if (!taken) return;
    if (window.location.hash === hash) {
      navigateToRoutePath(taken.routePath, { replace: true });
    }
    onLink(taken.link);
  };
  window.addEventListener("hashchange", onHashChange);
  return () => window.removeEventListener("hashchange", onHashChange);
};

/** Site login and Cashu links, as text for the scanned-text handler. */
export const subscribeScanHashLinks = (
  onText: (text: string) => void,
): (() => void) => subscribeHashLink(readScanHashLink, onText);

/** `?notificationOpen=` details from the service worker's tap target. */
export const subscribeNotificationOpenHashLinks = (
  onDetail: (detail: string) => void,
): (() => void) => subscribeHashLink(readNotificationOpen, onDetail);

/** `#add/<npub>` profile links from linky.fit, as the npub. */
export const subscribeAddContactHashLinks = (
  onNpub: (npub: string) => void,
): (() => void) => subscribeHashLink(readAddContact, onNpub);
