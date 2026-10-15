import {
  receiveLinkauth,
  type LinkauthQueryPool,
} from "../../../../packages/linkauth/src/server/index.js";
import type { ApiResponse } from "../_npubcash.js";
import {
  nonceCookie,
  readNonceCookie,
  requireAudience,
  requireMethod,
  requireReceiverKey,
  requireRelays,
  type DemoAuthRequest,
} from "../_demoAuth.js";

// Keep well under the function's maxDuration in vercel.json.
const RELAY_WAIT_MS = 3000;

/** `pool` lets tests stand in for the relays. */
export const createReceiveHandler =
  (pool?: LinkauthQueryPool) =>
  async (req: DemoAuthRequest, res: ApiResponse) => {
    if (!requireMethod("POST", req, res)) return;
    const audience = requireAudience(req, res);
    if (audience === null) return;
    const secretKey = requireReceiverKey(res);
    if (secretKey === null) return;
    const relays = requireRelays(audience, res);
    if (relays === null) return;
    const nonce = readNonceCookie(req, secretKey);
    if (nonce === null) {
      res.status(401).json({ error: "login-failed" });
      return;
    }

    const result = await receiveLinkauth({
      secretKey,
      relays,
      audience,
      nonce,
      maxWaitMs: RELAY_WAIT_MS,
      ...(pool === undefined ? {} : { pool }),
    });
    if (!result.ok && result.reason === "not-delivered") {
      res.status(202).json({ status: "pending" });
      return;
    }
    res.setHeader("Set-Cookie", nonceCookie(audience, "", 0));
    if (!result.ok) {
      console.warn("demo login rejected", result.reason);
      res.status(401).json({ error: "login-failed" });
      return;
    }
    res.status(200).json({ pubkey: result.pubkey });
  };

export default createReceiveHandler();
