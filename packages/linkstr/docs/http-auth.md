# HTTP auth

Three pure codecs turn your Nostr key into HTTP credentials: they sign an event and hand you a header value or an event object, and none of them touches a relay or needs the runtime. Use them when a server wants proof of key ownership: Blossom uploads (kind 24242), NIP-98 `Authorization` headers (kind 27235), and a push server's subscribe/unsubscribe challenge proof (also kind 27235). These events are never published; they only go to the server that asked for them.

## Codecs

Every encoder takes `now: UnixSeconds` explicitly; the caller owns the clock. `secretKey` is a `NostrSecretKey` ([identity-and-keys.md](./identity-and-keys.md)); the helpers never log or return it. There are no React atoms for any of these: they are synchronous functions, so call them wherever you already hold the secret key.

`makeBlossomUploadAuthHeader` signs the hash of the already-encrypted bytes you upload; `sha256` must match the body and `serverDomain` is the hostname only:

```ts
import {
  UnixSeconds,
  makeBlossomUploadAuthHeader,
  type NostrSecretKey,
} from "@linky-fit/linkstr";

const now = () => UnixSeconds.make(Math.floor(Date.now() / 1000));

export const uploadToBlossom = async (
  secretKey: NostrSecretKey,
  serverDomain: string,
  ciphertext: ArrayBuffer,
  encryptedSha256: string,
): Promise<string> => {
  const response = await fetch(`https://${serverDomain}/upload`, {
    method: "PUT",
    headers: {
      Authorization: makeBlossomUploadAuthHeader(
        { sha256: encryptedSha256, serverDomain },
        secretKey,
        now(),
      ),
      "Content-Type": "text/plain;charset=UTF-8",
    },
    body: ciphertext,
  });
  if (!response.ok) throw new Error(`upload rejected: ${response.status}`);
  return `https://${serverDomain}/${encryptedSha256}`;
};
```

`makeNip98AuthHeader({ url, method, payload? }, secretKey, now())` works the same way: sign the exact url and method you will request (the server compares them) and pass `payload` when the body is JSON, so its hash is bound to the header.

A push ownership proof is an event, not a header. The client asks the push server for a challenge, signs it with the action, and sends the event in the body of its subscribe or unsubscribe request:

```ts
import {
  UnixSeconds,
  makePushOwnershipProof,
  type NostrSecretKey,
} from "@linky-fit/linkstr";

declare const secretKey: NostrSecretKey;
declare const challenge: string; // from the server's challenge endpoint

const proof = makePushOwnershipProof(
  { action: "subscribe", challenge },
  secretKey,
  UnixSeconds.make(Math.floor(Date.now() / 1000)),
);
// body: JSON.stringify({ event: proof, … })
```

The server calls `verifyPushOwnershipProof(body.event)` on the parsed JSON. It checks the signature, the kind, that `challenge`, `action` and `pubkey` each appear exactly once, that the `pubkey` tag equals the event author, and the content string, and returns `{ event, action, challenge }`. What is left is the server's own request binding: that `event.pubkey` is the pubkey the client claims, that `action` matches the endpoint, a freshness window on `event.created_at`, and consuming the challenge nonce on first use. Of the `PushOwnershipProofFailure` values, `invalid-signature` and `invalid-pubkey` mean a forged or foreign proof; the rest mean a malformed request.

## Wire format

Each proof is a signed event serialized as JSON and never published.

| Proof                   | Kind  | Tags, in order                                                                               | Content               | Sent as                                             |
| ----------------------- | ----- | -------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------- |
| Blossom upload (BUD-01) | 24242 | `["t", "upload"]`, `["expiration", now + 600]`, `["x", sha256]`, `["server", serverDomain]`  | `Upload Blob`         | `Authorization: Nostr <base64url(event)>`           |
| NIP-98                  | 27235 | `["u", url]`, `["method", method]`, `["payload", sha256(JSON body)]` when a payload is given | empty                 | `Authorization: Nostr <base64(event)>`              |
| Push ownership proof    | 27235 | `["challenge", challenge]`, `["action", "subscribe" \| "unsubscribe"]`, `["pubkey", author]` | `linky-push-<action>` | the `event` field of the subscribe/unsubscribe body |

## Errors

The encoders do not fail; an invalid key cannot reach them because `NostrSecretKey` is validated at decode time. The verifier returns a `PushOwnershipProofFailure` string instead of a tagged error.
