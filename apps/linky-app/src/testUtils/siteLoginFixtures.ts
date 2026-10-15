import { authTemplate, createNonce } from "@linky-fit/linkauth";
import type { LinkauthLogin } from "@linky-fit/linkauth/signer";
import { makeIdentity } from "@linky-fit/linkstr/testing";

export const SHOP = "https://shop.example";
export const CALLBACK_URL = `${SHOP}/login/done`;
export const NONCE = createNonce();
export const SITE_PUBKEY = makeIdentity().pubkey;
export const SITE_RELAYS = ["wss://relay.shop.example"];

/** The query of a `#linkauth` link; omit `cb` for a cross-device (QR) link. */
export const linkauthFragment = (
  options: { cb?: string; origin?: string } = {},
): string =>
  `linkauth?${new URLSearchParams({
    o: options.origin ?? SHOP,
    n: NONCE,
    ...(options.cb === undefined ? {} : { cb: options.cb }),
  })}`;

const verified = (delivery: LinkauthLogin["delivery"]): LinkauthLogin => ({
  audience: SHOP,
  nonce: NONCE,
  template: authTemplate({ audience: SHOP, nonce: NONCE }),
  domain: {
    name: "Shop",
    icon: `${SHOP}/icon.png`,
    pubkey: SITE_PUBKEY,
    relays: SITE_RELAYS,
  },
  delivery,
});

/** A site verified through its domain document, answered by returning to its callback. */
export const callbackLogin = (): LinkauthLogin =>
  verified({ kind: "callback", url: CALLBACK_URL });

/** A site verified through its domain document, answered over its relays. */
export const nostrLogin = (): LinkauthLogin =>
  verified({ kind: "nostr", pubkey: SITE_PUBKEY, relays: SITE_RELAYS });
