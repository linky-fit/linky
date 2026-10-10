import { verifyLinkauth } from "../../../../packages/linkauth/src/server/index.js";
import type { ApiResponse } from "../_npubcash.js";
import {
  nonceCookie,
  readNonceCookie,
  requireAudience,
  requireMethod,
  requireReceiverKey,
  type DemoAuthRequest,
} from "../_demoAuth.js";

const loginFailed = (res: ApiResponse) =>
  res.status(401).json({ error: "login-failed" });

/**
 * Verifies the assertion against this request's cookie nonce and answers with
 * the user's key. There is no server-side nonce store: single use rests on
 * the cookie being cleared here, so a real site must keep nonces server-side.
 */
export default function handler(req: DemoAuthRequest, res: ApiResponse) {
  if (!requireMethod("POST", req, res)) return;
  const audience = requireAudience(req, res);
  if (audience === null) return;
  const secretKey = requireReceiverKey(res);
  if (secretKey === null) return;
  const nonce = readNonceCookie(req, secretKey);
  if (nonce === null) return loginFailed(res);
  res.setHeader("Set-Cookie", nonceCookie(audience, "", 0));

  const assertion =
    typeof req.body === "object" && req.body !== null && "assertion" in req.body
      ? req.body.assertion
      : null;
  const result = verifyLinkauth(assertion, { audience, nonce });
  if (!result.ok) {
    console.warn("demo login rejected", result.reason);
    return loginFailed(res);
  }
  res.status(200).json({ pubkey: result.pubkey });
}
