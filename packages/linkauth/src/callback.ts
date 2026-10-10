import { decodeJsonBase64Url, encodeJsonBase64Url } from "./encoding.js";
import { isLinkauthAssertion } from "./types.js";
import type { LinkauthAssertion } from "./types.js";

/** Fragment key carrying the signed event, base64url JSON. */
export const RESULT_KEY = "linkauth";
/** Fragment key carrying the failure reason. */
export const ERROR_KEY = "linkauth_error";

export const encodeAssertion = (assertion: LinkauthAssertion): string =>
  encodeJsonBase64Url(assertion);

export const decodeAssertion = (text: string): LinkauthAssertion | null => {
  const value = decodeJsonBase64Url(text);
  return isLinkauthAssertion(value) ? value : null;
};
