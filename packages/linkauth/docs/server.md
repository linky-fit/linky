# Server

Three calls: `domainDocument` builds the identity file you [publish](./domain.md), `verifyLinkauth` checks one assertion against the audience and nonce you issued, and `receiveLinkauth` fetches a cross-device login from the relays and verifies it. `verifyLinkauth` is pure: no network, no storage, no clock beyond `Date.now()` unless you pass `now`. All run on any runtime with Web Crypto; `receiveLinkauth` needs a global `WebSocket` (Node 22+, Vercel, Bun, edge runtimes) unless you pass a pool.

## Calling it

1. When a login starts, create a nonce with `createNonce()`, store it against the visitor's session with a short lifetime (a few minutes) and give it to the browser.
2. When the assertion comes back, take the nonce out of storage and delete it in the same step, whatever happens next.
3. Call `verifyLinkauth(assertion, { audience, nonce })`. `assertion` is the signed event or its JSON text. `audience` is your site's origin from configuration, never from the `Host` header or the request body.
4. On `ok`, `pubkey` is the user's key (hex; `nip19.npubEncode` from `nostr-tools` gives the `npub`) and `createdAt` is when they approved. Start your own session for it and discard the assertion.

`isLinkauthAssertion(body)` is a cheap shape check for rejecting request bodies that are not events before any other work; `isNonce(value)` tells whether a string would be accepted as a nonce, for example one read from storage that may be corrupt. `verifyLinkauth` does the actual checking.

```ts
import { createNonce } from "@linky-fit/linkauth";
import { verifyLinkauth } from "@linky-fit/linkauth/server";

const AUDIENCE = "https://shop.example";

interface NonceStore {
  put(sessionId: string, nonce: string): Promise<void>;
  /** Returns the nonce and deletes it in one step. */
  take(sessionId: string): Promise<string | null>;
}

export const startLogin = async (store: NonceStore, sessionId: string) => {
  const nonce = createNonce();
  await store.put(sessionId, nonce);
  return { nonce };
};

export const finishLogin = async (
  store: NonceStore,
  sessionId: string,
  assertion: unknown,
): Promise<string | null> => {
  const nonce = await store.take(sessionId);
  if (nonce === null) return null;
  const result = verifyLinkauth(assertion, { audience: AUDIENCE, nonce });
  if (!result.ok) {
    console.warn("login rejected", result.reason);
    return null;
  }
  return result.pubkey;
};
```

## Receiving a cross-device login

The QR code carries no callback, so the signer publishes the signed login to the relays in your [domain document](./domain.md), encrypted to your receiving key. The page cannot read it; your server does, when the page asks.

1. Start as above: nonce stored against the visitor's session, given to the browser (which renders `qrUrl`).
2. The page asks your server every couple of seconds, with its session cookie, whether the login arrived. Your server looks up the nonce for that session; never accept a nonce from the request.
3. Call `receiveLinkauth({ secretKey, relays, audience, nonce })`. It makes one query to the relays and returns. It holds no subscription, so it fits a serverless function.
4. On `{ ok: false, reason: "not-delivered" }` keep the nonce and answer "not yet". On any other result, take the nonce out of storage atomically and let only the caller whose take succeeded act on the result: two polls can both see `ok`, and the atomic take is what lets one of them start a session.

```ts
import { hexToBytes } from "nostr-tools/utils";
import { publicKeyOf, receiveLinkauth } from "@linky-fit/linkauth/server";

const AUDIENCE = "https://shop.example";
const RELAYS = ["wss://relay.damus.io", "wss://nos.lol"];

const keyHex = process.env.LINKAUTH_RECEIVER_KEY;
if (keyHex === undefined) throw new Error("LINKAUTH_RECEIVER_KEY is not set");
const secretKey = hexToBytes(keyHex);
/** The key your domain document publishes; throws at boot for a key that is not 32 bytes. */
export const receiverPubkey = publicKeyOf(secretKey);

interface PendingLogins {
  /** The nonce issued to this session; `null` once it is used or its lifetime has passed. Does not consume it. */
  peek(sessionId: string): Promise<string | null>;
  /** Deletes the nonce; true for exactly one of any concurrent callers. */
  take(sessionId: string, nonce: string): Promise<boolean>;
}

export const pollLogin = async (
  logins: PendingLogins,
  sessionId: string,
): Promise<
  { status: "pending" | "failed" } | { status: "done"; pubkey: string }
> => {
  const nonce = await logins.peek(sessionId);
  if (nonce === null) return { status: "failed" };
  const result = await receiveLinkauth({
    secretKey,
    relays: RELAYS,
    audience: AUDIENCE,
    nonce,
  });
  if (!result.ok && result.reason === "not-delivered") {
    return { status: "pending" };
  }
  if (!(await logins.take(sessionId, nonce))) return { status: "failed" };
  return result.ok
    ? { status: "done", pubkey: result.pubkey }
    : { status: "failed" };
};
```

A secret key that is not 32 bytes is not reported as a `TypeError` like a bad `audience` or `nonce`: it fails inside `getPublicKey` on the first poll. Build `secretKey` and call `publicKeyOf` when the server boots, as above, so a missing or malformed key fails the deploy instead of the first login.

`relays` must be the relays in your document: that is where signers publish. `receiveLinkauth` asks for kind 1059 events addressed to your key and tagged with the hash of your nonce (`["x", <SHA-256 hex of the nonce>]`) from the last `maxAgeSeconds` (300 by default) up to 60 seconds ahead of now, so flooding your public key with other wraps cannot push a login out of the query. It skips what does not decrypt or whose tag is not the hash of its own nonce, and verifies the first assertion carrying your nonce with `verifyLinkauth`, so everything under [What it checks](#what-it-checks) applies. Events that fail before the nonce check are other logins or noise and are ignored. An invalid `audience`, `nonce` or key throws `TypeError`, like `verifyLinkauth`.

Each call opens relay connections (a private `SimplePool`, closed afterwards) and waits up to `maxWaitMs` (5 seconds) for slow relays. Rate-limit the polling endpoint per session. Pass `pool` (anything with `querySync`) to reuse connections.

Relays keep a delivery until its NIP-40 expiration, 10 minutes after the signer published it (longer on relays that ignore expirations), so a call with the same nonce can find it again, and a `maxAgeSeconds` above 600 gains nothing. Taking the nonce on the first final result is what makes the login single-use.

`receiveLinkauth` surfaces four results: `ok`, `expired` and `from-future` (final answers to this nonce) and `not-delivered`. A delivery that is malformed, badly signed or fails any other check is skipped, so an invalid delivery looks like "nothing yet". Give every nonce a lifetime of your own, no longer than `maxAgeSeconds`, and stop polling after it: `not-delivered` never turns into a failure on its own.

## What it checks

In this order:

| Reason           | Meaning                                                                                |
| ---------------- | -------------------------------------------------------------------------------------- |
| `malformed`      | not JSON, or not a Nostr event                                                         |
| `bad-signature`  | the id or signature does not match the event                                           |
| `wrong-kind`     | another kind, for example a NIP-98 or NIP-42 event                                     |
| `wrong-template` | extra, missing or reordered tags, other content, or a non-normalized audience or nonce |
| `wrong-audience` | signed for another origin                                                              |
| `wrong-nonce`    | signed for another nonce (compared in constant time)                                   |
| `expired`        | `created_at` is older than `maxAgeSeconds` (300 by default)                            |
| `from-future`    | `created_at` is more than 60 seconds ahead of `now`                                    |

`receiveLinkauth` returns only some of these, as described above. Reasons are stable codes meant for your logs; answer the browser with one generic error. Expected failures never throw. An `audience` or `nonce` in your expectation that is not valid is a bug in your code and throws `TypeError`.

## When a login fails

Every failure ends the attempt: the nonce is gone, so the next try needs a new nonce and a new `start`. What to offer the user:

- `expired`: the approval was too old or the signer's clock is behind. Offer "try again" and, if it repeats, suggest checking the device clock.
- `from-future`: the signer's clock is ahead. Same.
- Any other reason (`malformed`, `wrong-*`, `bad-signature`): not expected from the Linky signer. Show one generic error, log the reason, offer "try again".
- A callback result of `denied` ([client](./client.md#callback-results)): the user said no. Offer "try again" without an error tone.
- No nonce for the session: it expired, was already used, or the same-device return landed in a different browser or an in-app webview, which has no session cookie. Offer the QR code or a "start again" action there.

## Options

`maxAgeSeconds` tightens or loosens the age window. `now` (Unix seconds) replaces the server clock, mainly for tests. Neither lets an assertion through that fails another check.

## What stays yours

- Keeping the receiving key secret, and the domain document it is published in.
- Nonce storage and single use. Without it an assertion can be replayed inside its window.
- The session, and what a public key is allowed to do. A valid assertion says who approved, not whether you want that key.
- Not keeping the assertion. Do not store it, log it in full or pass it to another service.
