import { normalizeAudience } from "../audience.js";
import { plainCallback } from "../domain.js";
import { isNonce } from "../nonce.js";

const SIGNER_APP_URLS = {
  production: "https://app.linky.fit",
  nightly: "https://nightly.app.linky.fit",
} as const;

export interface LinkauthLinksOptions {
  /** Your site's origin; the signer shows it and the assertion is bound to it. */
  audience: string;
  /** From `createNonce`, stored by your server. */
  nonce: string;
  /**
   * Your page the signer returns to: on `audience`, without query or
   * fragment, and listed in your domain document's `callbacks` (the signer
   * checks).
   */
  callbackUrl: string;
  /**
   * Which Linky build the links open: `production`
   * (`https://app.linky.fit`) by default, or `nightly`
   * (`https://nightly.app.linky.fit`), which has the latest login features.
   */
  signerApp?: keyof typeof SIGNER_APP_URLS;
  /** Base URL of another signer app, e.g. a local or preview build; overrides `signerApp`. */
  signerAppUrl?: string;
}

/** Two ways to one login with the Linky signer; both carry the same nonce. */
export interface LinkauthLinks {
  /** Same-device link: opens the Linky signer and returns to `callbackUrl`. Offer it as a button. */
  openUrl: string;
  /**
   * Cross-device link without a callback: show it as a QR code for the
   * Linky signer, which delivers the login over Nostr to your key. The
   * result reaches your server, not this page: have it call
   * `receiveLinkauth`.
   */
  qrUrl: string;
}

const signerLink = (
  signerAppUrl: string,
  args: { audience: string; nonce: string; callbackUrl?: string },
): string => {
  const params = new URLSearchParams({ o: args.audience, n: args.nonce });
  if (args.callbackUrl !== undefined) params.set("cb", args.callbackUrl);
  const url = new URL(signerAppUrl);
  url.hash = `linkauth?${params.toString()}`;
  return url.toString();
};

/**
 * Builds the Linky signer links for one login. Pure: no network, so it runs
 * in the browser and on a server. Throws `TypeError` for invalid options.
 */
export const linkauthLinks = (options: LinkauthLinksOptions): LinkauthLinks => {
  const audience = normalizeAudience(options.audience);
  if (audience === null) throw new TypeError("linkauth: invalid audience");
  const callbackUrl = plainCallback(audience, options.callbackUrl);
  if (callbackUrl === null) {
    throw new TypeError(
      "linkauth: callbackUrl must be on the audience, without query or fragment",
    );
  }
  const { nonce } = options;
  if (!isNonce(nonce)) throw new TypeError("linkauth: invalid nonce");
  const signerAppUrl =
    options.signerAppUrl ?? SIGNER_APP_URLS[options.signerApp ?? "production"];
  return {
    openUrl: signerLink(signerAppUrl, { audience, nonce, callbackUrl }),
    qrUrl: signerLink(signerAppUrl, { audience, nonce }),
  };
};
