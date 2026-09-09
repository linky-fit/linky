import { PENDING_DEEP_LINK_TEXT_STORAGE_KEY } from "../../utils/constants";
import { safeLocalStorageSet } from "../../utils/storage";
import { extractCashuTokenFromText } from "./tokenText";

/**
 * Pulls a cashu token out of the URL hash (`#wallet?cashu=<token>`, as used
 * by the `web+cashu` handler and onboarding QR links) and strips the query so
 * a reload cannot re-fire it.
 */
export const consumeCashuTokenFromHash = (): string | null => {
  if (typeof window === "undefined") return null;

  const rawHash = window.location.hash;
  if (!rawHash.includes("?")) return null;
  const token = extractCashuTokenFromText(rawHash);
  if (!token) return null;

  const cleanHash = rawHash.split("?")[0] || "#wallet";
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}${cleanHash}`,
  );
  return token;
};

/**
 * Login resets the hash and reloads, so a token arriving before sign-in is
 * parked where the authenticated shell replays pending deep links from.
 */
export const parkCashuTokenFromHashForLogin = (): void => {
  const token = consumeCashuTokenFromHash();
  if (!token) return;
  safeLocalStorageSet(PENDING_DEEP_LINK_TEXT_STORAGE_KEY, `cashu:${token}`);
};
