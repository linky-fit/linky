import {
  domainDocument,
  publicKeyOf,
} from "../../../packages/linkauth/src/server/index.js";
import type { ApiRequest, ApiResponse } from "./_npubcash.js";
import {
  demoCallback,
  requireAudience,
  requireMethod,
  requireRelays,
  requireReceiverKey,
} from "./_demoAuth.js";

/** The demo's domain document, served at `/.well-known/linkauth.json`. */
export default function handler(req: ApiRequest, res: ApiResponse) {
  if (!requireMethod("GET", req, res)) return;
  const audience = requireAudience(req, res);
  if (audience === null) return;
  const secretKey = requireReceiverKey(res);
  if (secretKey === null) return;
  const relays = requireRelays(audience, res);
  if (relays === null) return;
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=60");
  res.status(200).json({
    ...domainDocument({
      audience,
      name: "Linky auth demo",
      icon: `${audience}/icon.svg`,
      pubkey: publicKeyOf(secretKey),
      relays,
      callbacks: [demoCallback(audience)],
    }),
  });
}
