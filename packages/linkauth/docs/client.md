# Client

`linkauthLinks` builds the two Linky links for a login: `openUrl`, a same-device link, and `qrUrl`, a link for a QR code shown to the Linky app on another device. It is pure, with no network, so it also runs on your server. `connectNip46` is the optional fallback for other Nostr signers: it opens a NIP-46 session over relays and gives you a `nostrconnect://` link. Every channel yields the same signed event, which your [server](./server.md) verifies. The Linky links work only if your site publishes a [domain document](./domain.md).

## Starting a login

1. Get a fresh nonce from your server for this visitor.
2. `linkauthLinks({ audience, nonce, callbackUrl })`. `audience` is your site's origin; `callbackUrl` is a page on it that handles the same-device result (step 4), without query or fragment and listed in the document's `callbacks`. It throws `TypeError` for an invalid `audience` or `nonce`, and for a callback that is not on the origin or has a query or fragment; a callback the document does not list is refused by the signer.
3. Show `openUrl` as a button ("Open Linky") and `qrUrl` as a QR code ("Scan with Linky on another device"); the package renders no QR code, so pass the URL to a QR library. The QR code completes on your server, not in this page: poll your own endpoint, which calls [`receiveLinkauth`](./server.md#receiving-a-cross-device-login). The client SDK polls nothing.
4. On the callback page, `readCallback(location.hash)` returns the result. Call `clearCallback()` right after, then post the assertion to your server.
5. Only if you support other Nostr signers, and only when the user asks for one: `connectNip46({ audience, nonce, name, relays })` with the same nonce. Wait for `ready` (the relays are listening, at most 5 seconds), then show `uri` as a QR code or link; `assertion` resolves when a signer answers. The `uri` carries the pairing secret: keep it out of logs and requests. The session holds relay subscriptions until it ends, up to 5 minutes, so do not open it on every page view.

```ts
import {
  clearCallback,
  connectNip46,
  LinkauthError,
  linkauthLinks,
  readCallback,
} from "@linky-fit/linkauth/client";

declare const fetchNonce: () => Promise<string>;
declare const sendToServer: (assertion: unknown) => Promise<void>;
declare const showQr: (url: string) => void;
declare const showButton: (href: string) => void;
declare const showOtherSignerQr: (uri: string) => void;
declare const pollServerForLogin: (signal: AbortSignal) => Promise<void>;

const report = (error: unknown): void => {
  if (error instanceof LinkauthError && error.code === "cancelled") return;
  console.warn("login failed", error);
};

export const beginLogin = async (): Promise<{
  nonce: string;
  stop: () => void;
}> => {
  const nonce = await fetchNonce();
  const { openUrl, qrUrl } = linkauthLinks({
    audience: location.origin,
    nonce,
    callbackUrl: `${location.origin}/login/done`,
  });
  showButton(openUrl);
  showQr(qrUrl);
  const stopPolling = new AbortController();
  void pollServerForLogin(stopPolling.signal);
  return { nonce, stop: () => stopPolling.abort() };
};

/** Run when the user picks "Use another Nostr signer"; returns the cancel. */
export const connectOtherSigner = (nonce: string): (() => void) => {
  const login = connectNip46({
    audience: location.origin,
    nonce,
    name: "Shop",
    relays: ["wss://relay.damus.io", "wss://nos.lol"],
  });
  login.ready.then(() => showOtherSignerQr(login.uri), report);
  login.assertion.then(sendToServer, report);
  return login.cancel;
};

/** Run on `/login/done`. */
export const finishLogin = async (): Promise<void> => {
  const result = readCallback(location.hash);
  if (result === null) return;
  clearCallback();
  if ("assertion" in result) await sendToServer(result.assertion);
  else console.warn("login not completed", result.error);
};
```

Stop polling and cancel the NIP-46 session when the user leaves the login screen: `cancel` closes the relay subscription and wipes the pairing key. All channels use the same nonce: the first result your server verifies consumes it, and a second one finds the nonce gone.

## Options

Defaults are in the doc comments of `LinkauthLinksOptions` and `Nip46LoginOptions`. The decisions:

- `signerApp`: leave it on production; set `"nightly"` to open the nightly Linky build, which has the latest login features.
- `signerAppUrl`: a local or preview signer build during development ([Developing locally](./README.md#developing-locally)); it overrides `signerApp`.
- `name` and `image` of `connectNip46`: what the NIP-46 signer shows as your site. The signer cannot verify them, so it marks them as your page's claim. A blank `name` throws `TypeError`.
- `relays` of `connectNip46`: where the NIP-46 signer answers. The Linky links take their relays from your domain document instead.
- `connectTimeoutMs`: raise it if users need longer than the default to scan and approve a NIP-46 login. `replyTimeoutMs`: raise it for a signer that is slow to answer the sign request.
- `pool`: pass your own relay pool to share connections with the rest of your page; it is not closed for you.
- `signal`: aborting it is the same as `cancel()`.

## NIP-46 session errors

`assertion` rejects with a `LinkauthError` whose `code` is:

| Code                 | When                                                                        |
| -------------------- | --------------------------------------------------------------------------- |
| `cancelled`          | `cancel()` or the abort signal                                              |
| `timeout`            | no signer connected, or the connected one did not answer, in time           |
| `relays-unreachable` | no relay opened the subscription, or none took the request                  |
| `refused`            | the signer declined the pairing or the signing, or signed a different event |

Every error ends the attempt: fetch a fresh nonce and start again. `ready` rejects with the same error when the attempt ends before the relays are listening. A rejection nobody awaits is not reported, so you can call `cancel()` without awaiting `assertion`.

## Cross-device exposure

Neither a QR login nor a NIP-46 login is tied to the browser that shows it (see the [threat model](./README.md#threat-model)). In your page, offer `openUrl` first, label the QR code as for logging in on another device, and call `connectNip46` only if you want signers other than Linky.

Leaving a channel out of your page does not remove that exposure. An attacker's page can fetch a nonce from your site and show your QR link, and any NIP-46 signer signs a valid assertion for whatever origin a page claims, which the attacker's page can then post to your server. Linky refuses NIP-46 logins to origins that publish a domain document; other signers do not.

## Callback results

| `readCallback` returns | Meaning                                                      |
| ---------------------- | ------------------------------------------------------------ |
| `{ assertion }`        | the signer approved; decoded and shape-checked, not verified |
| `{ error: "denied" }`  | the user said no                                             |
| `{ error: "invalid" }` | the fragment is not a usable result                          |
| `null`                 | the page was not opened by a signer                          |

Verification happens only on your server.

A same-device return can land in a different browser or an in-app webview than the one that started the login. That page has no session and so no nonce on your server, and the login fails. Offer the QR code or a "start again" action there. For `denied`, `invalid` and the errors above, offer "try again" with a fresh nonce; what each server-side failure means is in [When a login fails](./server.md#when-a-login-fails).
