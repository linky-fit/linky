import { createNonce } from "../../../../packages/linkauth/src/index.js";
import type { ApiRequest, ApiResponse } from "../_npubcash.js";
import {
  NONCE_TTL_SECONDS,
  nonceCookie,
  requireAudience,
  requireMethod,
  requireReceiverKey,
  signedNonce,
} from "../_demoAuth.js";

/** Issues the one-time nonce for a login: in the response for the page, in a signed HttpOnly cookie for the verifier. */
export default function handler(req: ApiRequest, res: ApiResponse) {
  if (!requireMethod("GET", req, res)) return;
  const audience = requireAudience(req, res);
  if (audience === null) return;
  const secretKey = requireReceiverKey(res);
  if (secretKey === null) return;
  const nonce = createNonce();
  res.setHeader(
    "Set-Cookie",
    nonceCookie(audience, signedNonce(secretKey, nonce), NONCE_TTL_SECONDS),
  );
  res.status(200).json({ nonce });
}
