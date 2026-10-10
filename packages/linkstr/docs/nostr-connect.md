# Nostr Connect

`NostrConnect` is the signer side of NIP-46: it answers one `nostrconnect://` link for the configured identity. `NostrConnectClient` is the app side: it opens such a link and asks the user's signer to sign. It signs only two kinds of event, each on an explicit permission: a site login from [`@linky-fit/linkauth`](#the-site-login-event) and a [device authorization](#device-authorization). Never an event the site designed itself.

## The signer

A website shows a `nostrconnect://` link or QR code (NIP-46) to let a user sign in with their Nostr key. `NostrConnect.login` answers it once as the remote signer for the configured identity: it acknowledges the link, shares the public key, signs the site's login, then closes every subscription. There is no session and nothing is stored; a second login needs a fresh link.

### Calling it

1. Parse what the user scanned or opened with `parseNostrConnectUri(text)`. It returns a `NostrConnectRequest`, or `null` when the text is not a usable link: wrong scheme, no `relay` that is a valid `RelayUrl`, a client pubkey that is not on the curve, or no `secret`. Whitespace and scheme case are tolerated; duplicate relays are dropped and at most five are kept.
2. When `linkauthAudience(request)` returns an origin, the request is a site login. Any page can show a link that names another site's origin and relay what the user approves, and the signed login is the same one that site receives from its own Log in with Linky link. So first load the origin's domain document with `fetchDomainDocument(origin)` from `@linky-fit/linkauth`, and when it returns `ok: true`, refuse the request and point the user to the site's own Log in with Linky button. `NostrConnect.login` does not make this check; make it before calling it.
3. Show the user `name`, `url` and `image` before going on. The site supplies them itself and nothing verifies them. For a site login, show the origin prominently, as the site the user is signing in to, say that the site will see the identity's public key and profile, and ask them to approve only a login they started on that origin themselves. When `requestsDeviceAuthorization(request)` is true, say that approving also links one of the site's devices ([device authorization](#device-authorization)).
4. Call `login(request)`, or `nostrConnectLoginAtom` in React. It resolves with a `NostrConnectLoginReceipt` once the site got what it asked for.

```ts
import { Effect } from "effect";
import { NostrConnect, parseNostrConnectUri } from "@linky-fit/linkstr";

declare const scanned: string;

const program = Effect.gen(function* () {
  const request = parseNostrConnectUri(scanned);
  if (request === null) return null;
  const connect = yield* NostrConnect;
  return yield* connect.login(request);
});
```

Interrupting `login` (the user cancels, the screen unmounts) closes its subscriptions. Relays come from the link only; the identity's own read and write relays are not used.

### What the site can get

| Request          | Answer                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| `get_public_key` | the identity pubkey (hex)                                                                           |
| `sign_event`     | the signed event as a JSON string, only when the policy below allows it; `created_at` is set to now |
| `connect`        | `ack`                                                                                               |
| `ping`           | `pong`                                                                                              |
| anything else    | `error: unsupported method <method>`; the login keeps waiting, so optional probes do not break it   |

`sign_event` signs a template, with `created_at` set to now, in two cases:

- **A site login.** The link asks for `sign_event:24139` explicitly (`LINKAUTH_PERMISSION`; no perms or a bare `sign_event` do not cover it), has a `url` that is an acceptable site (https, or http on localhost), and the template is exactly the [canonical login](#the-site-login-event) for the origin of that `url`, with any valid nonce.
- **A device authorization.** The link's `perms` name `sign_event:24138` explicitly (`DEVICE_AUTHORIZATION_PERMISSION`; no perms or a bare `sign_event` do not cover it), the link has a `name`, and the template is exactly `deviceAuthorizationTemplate({ device, app: <that name> })`.

Anything else is refused, including NIP-98 (27235) and NIP-42 (22242) events: those are credentials a site must not be able to ask for. The site gets an `error` reply with the reason and `login` fails with `NostrConnectRequestRefused`.

### When it ends

| Situation                                                  | Result                                                                           |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| a `sign_event` was answered                                | receipt with `signedKind` set, and `authorizedDevice` for a device authorization |
| the pubkey was shared, then no request for 10 s            | receipt with `signedKind: null`                                                  |
| no relay accepted the ack or a reply                       | `NostrConnectAckNotDelivered` with each relay's `results`                        |
| no request subscription opened, or every one of them ended | `NostrConnectRelaysUnreachable` with each relay's `failures`                     |
| a `sign_event` was refused                                 | `NostrConnectRequestRefused` with `method` and `reason`                          |
| none of the above within 60 s                              | `NostrConnectTimedOut`                                                           |

Every error means the site is not logged in. Ask the user to refresh the link on the site and scan again; for `NostrConnectAckNotDelivered` and `NostrConnectRelaysUnreachable`, check the connection first, or ask the site for a link with other relays. A refusal is the site asking for more than a login, so do not retry it automatically.

### Wire format

Every message is a kind 24133 plain event signed by the identity, tagged `["p", <client pubkey>]`, with NIP-44 v2 content encrypted between the identity and the client pubkey. Requests from the site are the same shape in reverse; events that do not verify, do not decrypt with NIP-44 (NIP-04 is not supported) or repeat an id already answered are ignored.

1. Subscribe on the link's relays to `kinds: [24133]`, `authors: [client]`, `#p: [identity]`, `since: now - 60`, and wait until each relay reports end of stored events (at most 5 s). The events are ephemeral, so a relay only forwards them to subscriptions already open. If every subscription already ended, nothing is published. Subscriptions are never reopened: once the last one ends, the login fails at once instead of waiting for the timeout.
2. Publish the ack `{"id": <random>, "result": <secret>}` to the same relays.
3. Answer each request `{"id", "method", "params"}` with `{"id", "result"}` or `{"id", "error"}`.

24133 is also the payment-notice rumor kind ([payment-kinds.md](./payment-kinds.md#payment-notices)). They never collide: a payment notice only ever travels inside a kind 1059 gift wrap.

Inspector rows name the operation `nostrConnect.login`; its params omit the secret.

### The site login event

A login is a kind 24139 event defined by `@linky-fit/linkauth`: `authTemplate({ audience, nonce })` with the audience equal to `normalizeAudience(url)`. The signer checks it with `isCanonicalAuthTemplate(template, url)`, so the origin the user is shown is the origin that is signed, and a site cannot ask for a different one. The site's server verifies the signed event with `verifyLinkauth` (see the linkauth docs); linkstr only signs it.

## Device authorization

An app that logs a user in with their signer often also needs proof that one of its own keys (a device key) may act for that user. A device authorization is that proof: a kind 24138 event the user's key signs, naming the device key and the app the user approved. The signer never publishes it; the app embeds it wherever its peers look (for example the content of a [NIP-78 event](./plain-events.md#app-data-nip-78) the device signs).

| Field   | Value                                                                                                       |
| ------- | ----------------------------------------------------------------------------------------------------------- |
| kind    | 24138 (`DEVICE_AUTHORIZATION_KIND`)                                                                         |
| tags    | exactly `["linky", "device_authorization"]`, `["p", <device pubkey hex>]`, `["app", <name>]`, in that order |
| content | empty                                                                                                       |
| signer  | the user's key; `created_at` is when the user approved                                                      |

Build the template with `deviceAuthorizationTemplate({ device, app })`, where `app` is the `name` your link sends. `verifyDeviceAuthorization(eventOrJson)` checks the signature and the exact shape and returns a `DeviceAuthorization` (`author`, `device`, `app`, `createdAt`, `event`) or `null`. It does not decide trust: check that `author` is someone your app accepts, that `app` is your app's name, and that `device` is the key you received it from.

The `name` is the site's own claim, and the signer can only show it, so a site can claim another app's name. What the signature proves is that the user approved linking that device key under that name.

## The client

`NostrConnectClient.open(draft)` creates a throwaway client key and pairing secret, subscribes on the draft's relays and returns a `NostrConnectSession` once every relay is listening (at most 5 s). Show `session.uri` as a QR code or open `<signer web app>/#<uri>` on the same device; the URI carries the secret, so keep it out of logs and server requests. `session.connected` resolves with the signer's pubkey once it answers with the secret; `session.signEvent(template)` asks it to sign and verifies the reply is that template, signed. Closing the scope ends the subscriptions and wipes the client key.

```ts
import { Effect } from "effect";
import {
  DEVICE_AUTHORIZATION_PERMISSION,
  NostrConnectClient,
  NostrConnectClientDraft,
  deviceAuthorizationTemplate,
  verifyDeviceAuthorization,
  type Pubkey,
  type RelayUrl,
} from "@linky-fit/linkstr";

const linkDevice = (
  relays: readonly [RelayUrl, ...RelayUrl[]],
  device: Pubkey,
  show: (uri: string) => void,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const client = yield* NostrConnectClient;
      const session = yield* client.open(
        new NostrConnectClientDraft({
          relays,
          perms: [DEVICE_AUTHORIZATION_PERMISSION],
          name: "My app",
        }),
      );
      show(session.uri);
      const signed = yield* session.signEvent(
        deviceAuthorizationTemplate({ device, app: "My app" }),
      );
      return verifyDeviceAuthorization(signed);
    }),
  );
```

`connected` waits 5 minutes and each request 60 s by default (`open(draft, { connectTimeout, replyTimeout })`). Only events from the signer that answered with the secret count. A signer that ends its session after one signature, as `NostrConnect.login` does, answers one `signEvent` per link.

| Error                             | When                                                                 |
| --------------------------------- | -------------------------------------------------------------------- |
| `NostrConnectRelaysUnreachable`   | no subscription opened, or every one ended                           |
| `NostrConnectSignerTimedOut`      | no connect (`waitingFor: "connect"`) or no reply (`"reply"`) in time |
| `NostrConnectRequestNotDelivered` | no relay accepted the request                                        |
| `NostrConnectSignRefused`         | the signer answered with an error, or with a different event         |

Every error ends the attempt: open a fresh session for a new link. Inspector rows name the operation `nostrConnectClient.signEvent`, with the client pubkey and kind only.
