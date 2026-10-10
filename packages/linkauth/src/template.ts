import { normalizeAudience } from "./audience.js";
import { isNonce } from "./nonce.js";
import type { LinkauthTemplate } from "./types.js";

/** Linky-invented Nostr event kind of a login assertion. */
export const LINKAUTH_KIND = 24139;

/** The NIP-46 permission a client asks for. */
export const LINKAUTH_PERMISSION = `sign_event:${LINKAUTH_KIND}`;

/**
 * The one event a signer signs for a login. `audience` is a normalized
 * origin (see `normalizeAudience`), `nonce` comes from `createNonce`.
 * The content is human-readable for signers that show it.
 */
export const authTemplate = (args: {
  audience: string;
  nonce: string;
}): LinkauthTemplate => ({
  kind: LINKAUTH_KIND,
  tags: [
    ["linky", "auth"],
    ["audience", args.audience],
    ["nonce", args.nonce],
  ],
  content: `Log in to ${args.audience}`,
});

/** Same kind, tags and content, in the same order. */
export const sameTemplate = (
  a: LinkauthTemplate,
  b: LinkauthTemplate,
): boolean =>
  JSON.stringify([a.kind, a.tags, a.content]) ===
  JSON.stringify([b.kind, b.tags, b.content]);

/** The audience and nonce of a template that is exactly `authTemplate` of them; `null` otherwise. */
export const readAuthTemplate = (
  template: LinkauthTemplate,
): { audience: string; nonce: string } | null => {
  const audience = template.tags[1]?.[1];
  const nonce = template.tags[2]?.[1];
  if (
    audience === undefined ||
    nonce === undefined ||
    normalizeAudience(audience) !== audience ||
    !isNonce(nonce)
  ) {
    return null;
  }
  return sameTemplate(template, authTemplate({ audience, nonce }))
    ? { audience, nonce }
    : null;
};

/** Whether `template` is exactly the login event for `audience` (any valid nonce). */
export const isCanonicalAuthTemplate = (
  template: LinkauthTemplate,
  audience: string,
): boolean => {
  const expected = normalizeAudience(audience);
  return expected !== null && readAuthTemplate(template)?.audience === expected;
};
