# @linky-fit/linkauth

Log in with a Nostr key. A site publishes a small identity file, asks the user's signer for one purpose-built event bound to the site's origin and a one-time nonce, and verifies it on its server. No passwords, no NIP-98 or NIP-42 events chosen by the site. Plain promises and no Node built-ins: it runs in browsers, Node, Bun and edge runtimes.

## Install

```bash
bun add @linky-fit/linkauth
```

ESM with TypeScript declarations, for Node 22.14+ and browser bundlers. The guides import `nostr-tools/pure` and `nostr-tools/utils` directly: add `nostr-tools` to your own dependencies if you do the same. The package renders no QR code; pass the link to a QR library of your choice.

## What is in the box

| Entry                        | For                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `@linky-fit/linkauth`        | shared: `createNonce`, `normalizeAudience`, `authTemplate`, `fetchDomainDocument`, the kinds and the assertion type |
| `@linky-fit/linkauth/server` | `domainDocument`, `verifyLinkauth`, `receiveLinkauth`: publish your identity, verify and receive logins             |
| `@linky-fit/linkauth/client` | `linkauthLinks`, `readCallback`, `clearCallback`, `connectNip46`: the site's browser side                           |
| `@linky-fit/linkauth/signer` | `resolveLinkauthLink`, `wrapAssertion`, `buildCallbackUrl`, `isCanonicalAuthTemplate`: for apps that are signers    |

## How a login goes

1. Your site serves `/.well-known/linkauth.json`: its name, a receiving key, relays and callback pages. Signers trust nothing else about it.
2. Your server issues a nonce (`createNonce`) and remembers it.
3. The browser starts a login and shows a same-device link and a QR code for another device.
4. The signer loads your document, shows your verified name and origin, and on approval signs the login event with the user's Nostr key, their public identity on every site.
5. The assertion comes back, through your callback page (same device) or over relays encrypted to your key (QR code).
6. Your server calls `verifyLinkauth` or `receiveLinkauth`, consumes the nonce and starts its own session for the returned public key.

## Rules

- Your server is the only verifier; the browser decodes and forwards.
- The assertion proves one approval for one origin and one nonce. It is not a session and not a credential: exchange it for your own session and discard it.
- Nonces are single-use. `verifyLinkauth` does not store them; you do.

## Documentation

Guides are in [`docs/`](./docs/README.md); start with the threat model there, then the [domain document](./docs/domain.md).
