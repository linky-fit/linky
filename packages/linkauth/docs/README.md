# @linky-fit/linkauth guides

The exported types are the reference; the guides say what to call, in which order, and what each call guarantees.

## Guides

- [Domain document](./domain.md): publish `/.well-known/linkauth.json`, the identity signers verify
- [Server](./server.md): issue nonces, verify assertions, receive cross-device logins, start your session
- [Client](./client.md): start a login in the browser, show the button and the QR code, read the callback
- [Signer](./signer.md): resolve a login link, deliver the result, answer a NIP-46 sign request

## Minimal integration

Your site needs these routes (names are yours), in the order a login uses them:

1. `GET /.well-known/linkauth.json` serves the [domain document](./domain.md) built with `domainDocument`.
2. `POST /login/start` creates a nonce with `createNonce()`, stores it against the visitor's session and returns it. The page builds `openUrl` and `qrUrl` from it with `linkauthLinks` and shows them ([client](./client.md)).
3. The callback page `/login/done` (same-device) reads the result with `readCallback` and posts the assertion to the next route.
4. `POST /login/finish` takes the session's nonce, calls `verifyLinkauth` and starts your session ([server](./server.md)).
5. `GET /login/poll` (cross-device, only if you show the QR code) calls `receiveLinkauth` for the session's nonce until the login arrives or the nonce's lifetime ends ([server](./server.md#receiving-a-cross-device-login)).

## Developing locally

Use an `http://localhost`, `http://127.0.0.1` or `http://[::1]` origin as the audience. The domain document of such an origin may list `ws://` relays, for example a local relay. Point `signerAppUrl` of the [client](./client.md) at your local signer build.

## The protocol

A login assertion is one Nostr event signed by the user's Nostr key. Its `pubkey` is the user's identity on every site, and it is public: any site and any Nostr client can see it and the profile published under it.

| Field      | Value                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------ |
| kind       | 24139 (`LINKAUTH_KIND`)                                                                    |
| tags       | exactly `["linky", "auth"]`, `["audience", <origin>]`, `["nonce", <nonce>]`, in that order |
| content    | exactly `Log in to <origin>`                                                               |
| created_at | when the signer signed, set by the signer                                                  |

`authTemplate({ audience, nonce })` builds it; nothing else is accepted. The audience is the site's origin: https, or http on `localhost`, `127.0.0.1` and `[::1]` for development (`normalizeAudience`). The nonce is at least 16 random bytes as a URL-safe string: hand out `createNonce()` output only. `isNonce` accepts 22 to 128 base64url characters, and `verifyLinkauth`, `receiveLinkauth`, `linkauthLinks` and `connectNip46` throw `TypeError` for anything else.

### Channels

| Channel                   | Works with        | Site identity                        | How the result arrives                                                           |
| ------------------------- | ----------------- | ------------------------------------ | -------------------------------------------------------------------------------- |
| Same-device link          | the Linky signer  | verified through the domain document | the signer navigates to your callback page with the result in the fragment       |
| Cross-device QR           | the Linky signer  | verified through the domain document | the signer publishes it to relays, encrypted to your key; your server fetches it |
| Relay (`nostrconnect://`) | any NIP-46 signer | claimed by your page, unverified     | your page receives it over relays                                                |

The two Linky channels share a link: `<signer app>/#linkauth?o=<origin>&n=<nonce>[&cb=<callback>]`. It names the origin and the nonce and nothing else. The signer loads `<origin>/.well-known/linkauth.json` ([domain document](./domain.md)), takes the name, icon, key and relays from it, and refuses the login when it cannot. That file, not the link, is what the user is shown.

With `cb`, the login is browser-bound. `cb` must equal one of the document's callbacks; on approval the signer navigates to `<callback>#linkauth=<base64url JSON of the signed event>`, on denial to `<callback>#linkauth_error=denied`. The result sits in the fragment so it never reaches a server log. No relay and no open tab is needed.

Without `cb`, the login is cross-device. The signer signs the same event and publishes a **wrap** to the document's relays: a kind 1059 event from a throwaway key, tagged `["p", <document pubkey>]`, `["x", <SHA-256 hex of the login's nonce>]` and a NIP-40 `["expiration", <created_at + 600>]`, whose content is the assertion JSON NIP-44 encrypted to that key. The `x` tag lets relays select one login without learning the nonce. It is a hint: your server calls `receiveLinkauth` with the matching secret key, which unwraps the wrap, checks that its `x` tag matches the nonce inside, and verifies the assertion. The expiration lets relays drop the wrap after 10 minutes, so a site key that leaks later does not expose old logins.

The NIP-46 channel is plain NIP-46 for signers that do not know Linky: a `nostrconnect://` link with `perms=sign_event:24139` and `url=<audience>`, NIP-44 encrypted kind 24133 events, a throwaway client key. Such a signer sees only what the link claims; treat it as a fallback, opened with `connectNip46` only when the user asks for another signer.

## Threat model

What a verified assertion proves: the holder of `pubkey` approved, at `createdAt`, a login to exactly this origin with exactly this nonce. The event has a kind and shape no other Nostr use signs, so a site cannot turn it into a payment, a relay credential or an HTTP credential for another service by choosing what to put in it.

What the verified domain adds on the Linky channels: the name and icon the signer shows are the ones the origin published itself, so a page that is not yours cannot put your audience next to its own name; a same-device result can only be delivered to a callback you listed, so an assertion for your origin cannot be redirected to another site; and a cross-device result is encrypted to a key only your server holds.

What it does not prove:

- That a person, rather than a script holding the key, approved it.
- That the user looked at the origin the signer showed. A signer that signs without showing it defeats the binding.
- That a NIP-46 signer's `name` and `image` are true. The page supplies them and that signer cannot check them; trust only the audience.
- That the verified name is the site's true name. The name and icon are the origin's own claim: an origin that merely resembles yours can publish a document that says it is you. The origin is what the signer verified; trust it over the name.
- That whoever controls `/.well-known/` on the origin is the site's owner. Do not let others write files there.

Known risks and what to do about them:

- **Fixation through a QR code.** A cross-device login is not tied to the browser that shows the QR code. A malicious page can fetch a login from your site, show the QR code of that real attempt and wait: a user who scans it and approves sees the true name and origin and a real login, but the session it creates belongs to the attacker's browser, logged in as the user. The verified document does not close this, since the QR code is legitimate. Reduce it: have the signer ask the user to approve only a login they started on that site themselves, say so next to the QR code, and offer the same-device link first. Hiding your QR code does not remove the NIP-46 fixation below.
- **The same-device link has no such gap.** The signer returns the result only to a callback listed in the origin's own document, so an attacker's page cannot receive a login for your origin through it, and a login for the attacker's origin is useless to you.
- **Fixation through NIP-46.** Any NIP-46 signer can sign a valid assertion for whatever origin a `nostrconnect://` page claims, and the assertion is the same whichever channel produced it, so your server cannot tell where it came from. An attacker's page can take a nonce from your site in its own session, show a `nostrconnect://` QR code naming your origin, and post what the user approves to your verification route: the attacker's session is logged in as the user. This works whether or not your page offers the NIP-46 channel, and no site setting removes it for users of other signers. The Linky signer refuses NIP-46 logins to any origin that publishes a [domain document](./domain.md), so Linky users are covered once you publish one; a signer that runs the same check covers its users too. Such a signer also refuses your own `nostrconnect://` link and sends its user to your Linky button.
- **One identity everywhere.** The assertion is signed by the user's Nostr key, which is public and the same on every site: sites can see the user's public Nostr profile and tell that the same user logged in to each of them.
- **Replay.** The nonce and the age window bound it, but only if you consume each nonce once. This package cannot do that for you: it has no storage. Store the nonce when you issue it and delete it when you verify, whatever the outcome; with `receiveLinkauth`, delete it on every result except `not-delivered`.
- **Using the assertion as a credential.** It is a one-time proof of approval, signed by the user's Nostr key. Never keep it, forward it, or accept it as a bearer token, and never send it to a service you do not operate.
- **Delivery metadata.** Wraps are public events: relays see that something encrypted was delivered to your key at a time, not which user or what.
- **Clock skew.** `created_at` comes from the signer's clock. `verifyLinkauth` accepts 5 minutes of age and 60 seconds into the future by default.
- **Leaked fragments.** `readCallback` reads the result from the URL fragment; call `clearCallback` right after so it does not stay in the address bar or history.
