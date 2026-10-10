import { decodeAssertion, ERROR_KEY, RESULT_KEY } from "../callback.js";
import type { LinkauthAssertion } from "../types.js";

/** What the signer sent back to the callback page. */
export type LinkauthCallback =
  | { assertion: LinkauthAssertion }
  /** `denied`: the user said no. `invalid`: the fragment is not a usable result. */
  | { error: "denied" | "invalid" };

/**
 * Reads the signer's answer from the callback page's URL or fragment, for
 * example `readCallback(location.hash)`. Returns `null` when the page was
 * not opened by a signer. The assertion is decoded, not verified: send it to
 * your server and call `verifyLinkauth` there.
 */
export const readCallback = (urlOrHash: string): LinkauthCallback | null => {
  const hashStart = urlOrHash.indexOf("#");
  const params = new URLSearchParams(
    hashStart === -1 ? urlOrHash : urlOrHash.slice(hashStart + 1),
  );
  const result = params.get(RESULT_KEY);
  if (result !== null) {
    const assertion = decodeAssertion(result);
    return assertion === null ? { error: "invalid" } : { assertion };
  }
  const error = params.get(ERROR_KEY);
  if (error === null) return null;
  return { error: error === "denied" ? "denied" : "invalid" };
};

/** Removes the fragment from the address bar so the result is not kept in history or shared. */
export const clearCallback = (): void => {
  history.replaceState(
    history.state,
    "",
    `${location.pathname}${location.search}`,
  );
};
