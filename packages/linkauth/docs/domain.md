# Domain document

Every site that offers login publishes one small JSON file. It is the only thing a signer trusts about a site: the name and icon it shows, the key logins are delivered to, the relays they travel over and the pages a login may return to all come from it, over TLS, from the site's own origin. A login link carries nothing but the origin, the nonce and an optional callback.

## Publishing it

Serve `GET <origin>/.well-known/linkauth.json` with `Content-Type: application/json` and CORS open to everyone:

```
Access-Control-Allow-Origin: *
```

The signer app reads the file from the browser, so without that header every login is refused as `unreachable`. The file is public and carries no credentials, so `*` exposes nothing.

Serve it directly at the exact origin you use as the audience. A redirect of any kind (`www` to the apex, a trailing slash, `http` to `https`) is refused, and every login then fails as `unreachable`. Check with `curl -i <origin>/.well-known/linkauth.json`: expect a 200 and no `Location` header.

```json
{
  "version": 1,
  "name": "Example Shop",
  "icon": "https://example.com/icon.png",
  "pubkey": "<64 lowercase hex>",
  "relays": ["wss://relay.example.com"],
  "callbacks": ["https://example.com/login/"]
}
```

Build it with `domainDocument` from `@linky-fit/linkauth/server`, which throws when a signer would reject the result, and serve it from any runtime that speaks `Request` and `Response`:

```ts
import { DOMAIN_DOCUMENT_PATH } from "@linky-fit/linkauth";
import { domainDocument, publicKeyOf } from "@linky-fit/linkauth/server";

declare const receiverKey: Uint8Array;

const body = JSON.stringify(
  domainDocument({
    audience: "https://shop.example",
    name: "Shop",
    icon: "https://shop.example/icon.png",
    pubkey: publicKeyOf(receiverKey),
    relays: ["wss://relay.damus.io", "wss://nos.lol"],
    callbacks: ["https://shop.example/login/done"],
  }),
);

/** Returns `null` for every other path. */
export const serveDomainDocument = (request: Request): Response | null =>
  new URL(request.url).pathname === DOMAIN_DOCUMENT_PATH
    ? new Response(body, {
        headers: {
          "content-type": "application/json",
          "access-control-allow-origin": "*",
          "cache-control": "public, max-age=300",
        },
      })
    : null;
```

The document changes only when you change configuration. Cache it for minutes, not days: a key rotation must take effect within minutes.

## Rules

A signer applies these strictly; one failure refuses the whole document, and `domainDocument` throws for the same problems. Unknown fields are ignored.

- `version` is the number `1`.
- `name` is not blank and at most 100 UTF-16 units, counted before trimming; signers show it trimmed. It may not contain control, line-separator or invisible format characters (bidirectional marks and the zero-width space included); the joiners U+200C and U+200D are allowed.
- `icon` is optional: an absolute URL on the document's own origin, without credentials.
- `pubkey` is 64 lowercase hex characters, a valid public key.
- `relays` are 1 to 5 `wss://` URLs without credentials or a fragment.
- `callbacks` are 1 to 10 URLs on the document's own origin, without query or fragment; a link's callback must equal one of them.

On a localhost origin the icon and callbacks are http, and `ws://` relays are allowed ([Developing locally](./README.md#developing-locally)).

Callbacks are exact: `https://shop.example/login/done` does not cover `https://shop.example/login/done/` or `https://shop.example/login/done?next=/cart`. Both sides compare URLs after `new URL(x).href` normalization. Keep the post-login destination in your own session, not in the callback URL.

## Fetch rules

`fetchDomainDocument(origin)` is what signers call. It is browser-safe and never throws. It sends no credentials or referrer, follows no redirects, gives up after 5 seconds and reads at most 4096 bytes, so keep the document small.

| `reason`                     | Meaning                                                                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `invalid-origin`             | not an acceptable site: https, or http on localhost, no credentials                                                                       |
| `unreachable`                | network error, timeout, redirect or a status other than 2xx                                                                               |
| `too-large`                  | the body is over 4096 bytes                                                                                                               |
| `invalid-json`               | the body is not UTF-8 JSON                                                                                                                |
| `invalid-document:<problem>` | a rule above failed: `not-an-object`, `bad-version`, `bad-name`, `bad-icon`, `bad-pubkey`, `bad-relays` or `bad-callbacks` as `<problem>` |

Do not call it from a server with an origin that a user chose: it is a request to a user-chosen address. Signers run on the user's device, where that is the user's own request.

`parseDomainDocument(json, origin)` applies the same rules to JSON you already have and returns a result you can switch on. `origin` must be exactly what `normalizeAudience` returns for it: anything else throws `TypeError`.

## The receiving key

`pubkey` is the public half of a key your server holds. Cross-device logins are encrypted to it, so whoever holds the secret key can read every login delivered to your site while it is still on a relay (`receiveLinkauth` only looks 5 minutes back).

- Generate a key used for nothing else, for example `openssl rand -hex 32`, and keep it in your secrets store; turn it into bytes with `hexToBytes` from `nostr-tools/utils`.
- It never appears in the document, in logs, or in the browser. Only `publicKeyOf(secretKey)` is published.
- A leaked key lets an attacker read assertions, not forge them: each one is signed by the user, bound to your origin and to a nonce only your server accepts once. Rotate anyway: generate a new key, publish its public key, and deploy both together. A login in flight at that moment fails and the user retries.
- Relays only carry ciphertext and a throwaway sender, but they can see that a login was delivered to your key and when.

## What the document does not do

It proves the name and key belong to whoever controls the origin's root `/.well-known/` path over TLS, nothing more. A host that lets other parties write files at that path hands them your site's identity. The `name` is your own claim: signers show it next to the origin they verified, and trust the origin over the name.
