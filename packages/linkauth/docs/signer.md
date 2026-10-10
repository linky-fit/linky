# Signer

For apps that hold the user's key and answer logins. Signing and publishing stay in your app: the helpers resolve and validate what a site sent and build what goes back, and never see a key or open a connection other than the site's one small document fetch.

## Answering a login link

1. Detect the link with `isLinkauthLink(text)` (cheap, synchronous, true even for an unusable link), then call `await resolveLinkauthLink(text)`. It parses the link, loads the origin's [domain document](./domain.md) and, for a same-device link, checks the callback against it. It never throws and fails closed: whatever cannot be verified is refused.
2. On `{ ok: false, reason }` show a refusal and sign nothing. `not-a-linkauth-link` means the text is not a login link at all (gate on `isLinkauthLink` and route other text elsewhere); `unverified-domain` carries `detail`, the fetch or document problem; `callback-not-listed` means the link's `cb` is not one of the document's callbacks; `malformed-link` means the link starts like a login but is unusable.
3. On `{ ok: true, login }`, show the user `login.audience` together with `login.domain.name` and `login.domain.icon`. They come from the origin's own document; the link supplied none of them. The name is the origin's own claim, not proof of who owns the site: what was verified is the origin, so show it prominently and trust it over the name.
4. On approval, sign `login.template` with `created_at` set to now using the user's Nostr key. Its public key is the user's identity on every site, so tell the user the site will see their public profile.
5. Deliver by `login.delivery.kind`:
   - `"callback"`: navigate to `buildCallbackUrl(login.delivery.url, signed)`. On denial, `buildCallbackUrl(login.delivery.url, "denied")`.
   - `"nostr"`: publish `wrapAssertion(signed, login.delivery.pubkey)` to `login.delivery.relays` with your own relay stack and tell the user to go back to the other device. Publishing is not part of this package. A denial sends nothing.

```ts
import { finalizeEvent } from "nostr-tools/pure";
import {
  buildCallbackUrl,
  resolveLinkauthLink,
  wrapAssertion,
} from "@linky-fit/linkauth/signer";

declare const secretKey: Uint8Array;
declare const askUser: (login: {
  audience: string;
  name: string;
  icon: string | null;
}) => Promise<boolean>;
declare const publish: (relays: string[], event: object) => Promise<void>;

/** Returns the URL to navigate to, or `null` when there is none. */
export const answerLink = async (text: string): Promise<string | null> => {
  const resolved = await resolveLinkauthLink(text);
  if (!resolved.ok) return null;
  const { login } = resolved;
  const approved = await askUser({
    audience: login.audience,
    name: login.domain.name,
    icon: login.domain.icon,
  });
  const { delivery } = login;
  if (!approved) {
    return delivery.kind === "callback"
      ? buildCallbackUrl(delivery.url, "denied")
      : null;
  }
  const signed = finalizeEvent(
    { ...login.template, created_at: Math.floor(Date.now() / 1000) },
    secretKey,
  );
  if (delivery.kind === "callback")
    return buildCallbackUrl(delivery.url, signed);
  await publish(delivery.relays, wrapAssertion(signed, delivery.pubkey));
  return null;
};
```

`parseLinkauthLink(text)` is the offline half and verifies nothing about the site. Use it only to tell links apart; never show what it returns as a verified identity.

`resolveLinkauthLink` takes `fetch` (your own `fetch`, for tests or a proxy) and `timeoutMs` (5 seconds by default), like `fetchDomainDocument`, which it calls.

The audience is the origin from the link's `o`, which must be exactly an origin, and the document is fetched from that same origin without following redirects: a link can only name a site that vouches for itself. Never take an audience from anywhere else.

### Cross-device logins

`wrapAssertion(signed, delivery.pubkey)` returns a ready-to-publish Nostr event, the [wrap](./README.md#channels) of the protocol, signed by a fresh throwaway key. It throws `TypeError` for a malformed assertion or one that is not the canonical login event. The site's server finds it by asking its relays, so publish to all of `delivery.relays` and treat success on at least one as success. Show the user that the approval was sent; the result appears on the other device.

Ask the user to approve a cross-device login only if they started it themselves on that site: anyone can show a real QR code from a site (see the [threat model](./README.md#threat-model)). A same-device link has no such gap.

## Answering a NIP-46 sign request

A site that uses the NIP-46 channel sends a `nostrconnect://` link with `perms=sign_event:24139` and `url=<its origin>`, then a `sign_event` request. Any page can send such a link naming any origin, and the assertion you sign is the same as on the Linky channels, so the site cannot tell who relayed it ([threat model](./README.md#threat-model)). Before you show the request, refuse it when the origin publishes a domain document: that site takes logins through its own `#linkauth` link, which is bound to it, so tell the user to use the site's Log in with Linky button instead. If the document cannot be loaded, go on, and show the origin as a claim you could not verify.

```ts
import {
  fetchDomainDocument,
  normalizeAudience,
} from "@linky-fit/linkauth/signer";

export const publishesDomainDocument = async (
  url: string,
): Promise<boolean> => {
  const origin = normalizeAudience(url);
  return origin !== null && (await fetchDomainDocument(origin)).ok;
};
```

Then sign a request of kind 24139 only when:

- the link asked for `sign_event:24139` (`LINKAUTH_PERMISSION`);
- the link has a `url` that `normalizeAudience` accepts;
- `isCanonicalAuthTemplate(template, url)` is true.

```ts
import {
  isCanonicalAuthTemplate,
  LINKAUTH_KIND,
  LINKAUTH_PERMISSION,
} from "@linky-fit/linkauth/signer";

interface Template {
  kind: number;
  tags: string[][];
  content: string;
}

export const mayLogIn = (
  link: { perms: readonly string[]; url: string | null },
  template: Template,
): boolean =>
  template.kind === LINKAUTH_KIND &&
  link.perms.includes(LINKAUTH_PERMISSION) &&
  link.url !== null &&
  isCanonicalAuthTemplate(template, link.url);
```

A bare `sign_event` permission or no permissions at all does not cover this kind: the user approves a login explicitly. Refuse any other template, including NIP-98 and NIP-42 events, as a login: a login is never a general signing request.
