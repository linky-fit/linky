import { decodeNpub } from "@linky-fit/linkstr";
import { buildProfileShareUrl } from "./utils/deepLinks";

const ADD_CONTACT_HASH = /^#add\/(npub1[a-z0-9]+)$/i;

/** The link a linky.fit profile page opens: `#add/<npub>`. */
export const readAddContactNpubFromHash = (hash: string): string | null => {
  const npub = ADD_CONTACT_HASH.exec(hash)?.[1]?.toLowerCase();
  return npub && decodeNpub(npub) ? npub : null;
};

/** Takes an `#add/<npub>` link out of the address bar and its history entry. */
export const takeAddContactHashLink = (): string | null => {
  const npub = readAddContactNpubFromHash(window.location.hash);
  if (npub) {
    const { pathname, search } = window.location;
    window.history.replaceState(null, "", `${pathname}${search}#contacts`);
  }
  return npub;
};

/** Prefers the claimed linky.fit name, which reads better in a chat than an npub. */
export const buildOwnProfileShareUrl = (
  npub: string,
  lightningAddress: string | null,
  ownedLightningAddresses: readonly string[],
): string => {
  const [name, domain] = (lightningAddress ?? "").toLowerCase().split("@");
  const ownsLinkyName =
    domain === "linky.fit" &&
    name &&
    ownedLightningAddresses.some(
      (owned) => owned.toLowerCase() === `${name}@linky.fit`,
    );
  return buildProfileShareUrl(ownsLinkyName ? name : npub);
};
