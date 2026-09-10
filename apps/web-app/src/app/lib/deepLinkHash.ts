import {
  PENDING_DEEP_LINK_TEXT_STORAGE_KEY,
  PENDING_ONBOARDER_NPUB_STORAGE_KEY,
} from "../../utils/constants";
import { normalizeNpubIdentifier } from "../../utils/nostrNpub";
import { safeLocalStorageSet } from "../../utils/storage";
import { extractCashuTokenFromText } from "./tokenText";

export const ONBOARDER_HASH_PARAM = "onboarder";

interface HashDeepLink {
  readonly cashuToken: string | null;
  readonly onboarderNpub: string | null;
}

const readHashDeepLink = (rawHash: string): HashDeepLink => {
  const queryIndex = rawHash.indexOf("?");
  if (queryIndex < 0) return { cashuToken: null, onboarderNpub: null };
  const params = new URLSearchParams(rawHash.slice(queryIndex + 1));
  return {
    cashuToken: extractCashuTokenFromText(rawHash),
    onboarderNpub: normalizeNpubIdentifier(
      params.get(ONBOARDER_HASH_PARAM) ?? "",
    ),
  };
};

/**
 * Moves deep-link data out of the URL hash (`#wallet?cashu=<token>` from the
 * `web+cashu` handler, `&onboarder=<npub>` from onboarding QR links) into the
 * storage keys the authenticated shell replays from once the owners are
 * ready. Runs once per page load before any shell mounts: login resets the
 * hash and reloads, so a token or npub left in the URL would be lost, and a
 * consumed hash is stripped so a reload cannot re-fire it.
 */
export const parkDeepLinkFromHash = (): void => {
  if (typeof window === "undefined") return;

  const rawHash = window.location.hash;
  const { cashuToken, onboarderNpub } = readHashDeepLink(rawHash);
  if (!cashuToken && !onboarderNpub) return;

  if (cashuToken) {
    safeLocalStorageSet(
      PENDING_DEEP_LINK_TEXT_STORAGE_KEY,
      `cashu:${cashuToken}`,
    );
  }
  if (onboarderNpub) {
    safeLocalStorageSet(PENDING_ONBOARDER_NPUB_STORAGE_KEY, onboarderNpub);
  }

  const cleanHash = rawHash.split("?")[0] || "#wallet";
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}${cleanHash}`,
  );
};
