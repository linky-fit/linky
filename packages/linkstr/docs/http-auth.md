# HTTP auth

`httpAuth` turns your nostr key into HTTP credentials. Three pure codecs sign an event and hand you a header or an event object; none of them touches a relay or needs the runtime. Use them when a server wants proof of key ownership: Blossom uploads (kind 24242), NIP-98 `Authorization` headers (kind 27235), and the push server's subscribe/unsubscribe challenge proof (also kind 27235). These events are never published — they are only ever sent to the server that asked for them.

## Quick example

Prerequisites: a `NostrSecretKey` — see [getting-started.md](./getting-started.md). Every encoder takes `now` explicitly; the caller owns the clock.

Blossom — upload already-encrypted bytes. `sha256` is the hash of the ciphertext you upload, `serverDomain` is the hostname only:

```ts
import {
  UnixSeconds,
  makeBlossomUploadAuthHeader,
  type NostrSecretKey,
} from "@linky/linkstr";

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

NIP-98 — sign the exact url and method you will request; add `payload` when the body is JSON:

```ts
import {
  UnixSeconds,
  makeNip98AuthHeader,
  type NostrSecretKey,
} from "@linky/linkstr";

export const putMintPreference = async (
  secretKey: NostrSecretKey,
  mintUrl: string,
): Promise<void> => {
  const url = "https://npub.linky.fit/api/v1/info/mint";
  const payload = { mintUrl };
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: makeNip98AuthHeader(
        { url, method: "PUT", payload },
        secretKey,
        UnixSeconds.make(Math.floor(Date.now() / 1000)),
      ),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`rejected: ${response.status}`);
};
```

Push ownership — an event, not a header. First ask the push server for a challenge (`POST /auth/challenge` with `{ action, pubkey }`), then send the proof in the JSON body of the subscribe or unsubscribe request:

```ts
import {
  UnixSeconds,
  makePushOwnershipProof,
  type NostrSecretKey,
  type Pubkey,
} from "@linky/linkstr";

export const proveSubscribe = async (
  pushServerUrl: string,
  secretKey: NostrSecretKey,
  pubkey: Pubkey,
) => {
  const challengeResponse = await fetch(`${pushServerUrl}/auth/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "subscribe", pubkey }),
  });
  if (!challengeResponse.ok) throw new Error("challenge refused");
  const { challenge } = (await challengeResponse.json()) as {
    challenge: string;
  };
  return makePushOwnershipProof(
    { action: "subscribe", challenge },
    secretKey,
    UnixSeconds.make(Math.floor(Date.now() / 1000)),
  );
};
```

The app's version, with response decoding and the surrounding subscription flow, is `apps/web-app/src/utils/pushNotifications.ts`. No React atom exists for any of these: they are synchronous functions, so call them inside whatever hook already holds the secret key.

## Codecs

| Function                                             | Draft                                                                         | Returns                                                         |
| ---------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `makeBlossomUploadAuthHeader(draft, secretKey, now)` | `BlossomUploadAuthDraft { sha256, serverDomain }`                             | `Authorization` header value; valid for 600 s                   |
| `makeNip98AuthHeader(draft, secretKey, now)`         | `Nip98AuthDraft { url, method, payload?: Record<string, string> }`            | `Authorization` header value bound to that url and method       |
| `makePushOwnershipProof(draft, secretKey, now)`      | `PushOwnershipProofDraft { action: "subscribe" \| "unsubscribe", challenge }` | `SignedPlainEvent` bound to the challenge and action            |
| `verifyPushOwnershipProof(input)`                    | `unknown` (the parsed JSON)                                                   | `Either<VerifiedPushOwnershipProof, PushOwnershipProofFailure>` |

- `secretKey` is a `NostrSecretKey`; get one with `decodeNsec` ([identity-and-keys.md](./identity-and-keys.md)). The helpers never log or return it.
- NIP-98: the server compares the signed url with the request url, so sign what you actually send. The app signs the bare path and leaves query strings out where the server does (`npubCashUpstreamQuotes.ts`).
- Blossom: the `sha256` in the header must match the uploaded bytes, or the server rejects the upload.

## Server-side verification

`verifyPushOwnershipProof` checks signature, kind, the exactly-once `challenge` / `action` / `pubkey` tags, that the `pubkey` tag equals the event author, and the content string. Everything about _your_ request is still yours to check. `apps/push/src/ownership.ts` does it like this:

```ts
import { verifyPushOwnershipProof } from "@linky/linkstr";
import type { PushOwnershipProofFailure } from "@linky/linkstr";

const failureStatus: Record<PushOwnershipProofFailure, number> = {
  "malformed-event": 400,
  "invalid-signature": 401,
  "wrong-kind": 400,
  "invalid-challenge": 400,
  "invalid-action": 400,
  "invalid-pubkey-tag": 400,
  "invalid-pubkey": 401,
  "wrong-content": 400,
};

interface ProofRequest {
  body: { event: unknown }; // the parsed JSON body
  pubkey: string; // the pubkey the client claims
  action: "subscribe" | "unsubscribe"; // what this endpoint does
  nowSeconds: number;
  proofMaxAgeSeconds: number;
  /** Placeholder: returns false unless the nonce was issued to this pubkey and is unused. */
  consumeChallenge: (challenge: string, pubkey: string) => boolean;
}

/** Returns the HTTP status to reject with, or null when the proof is good. */
export const checkProof = (request: ProofRequest): number | null => {
  const decoded = verifyPushOwnershipProof(request.body.event);
  if (decoded._tag === "Left") return failureStatus[decoded.left];
  const { event, action, challenge } = decoded.right;

  if (event.pubkey !== request.pubkey) return 401;
  if (action !== request.action) return 401;
  if (
    Math.abs(request.nowSeconds - event.created_at) > request.proofMaxAgeSeconds
  )
    return 401;
  if (!request.consumeChallenge(challenge, request.pubkey)) return 401;
  return null;
};
```

The four follow-up checks are what make the proof single-use and bound to this request: the pubkey the client claims, the action the endpoint performs, a freshness window, and a stored challenge nonce that is consumed on first use.

## Errors

The encoders do not fail; an invalid key cannot reach them because `NostrSecretKey` is validated at decode time. The verifier returns a `PushOwnershipProofFailure` string. `invalid-signature` and `invalid-pubkey` (the `pubkey` tag differs from the event author) mean a forged or foreign proof, so answer 401; every other value is a malformed request, so answer 400 — the table in the snippet above maps them.

## Related

- [identity-and-keys.md](./identity-and-keys.md) — `decodeNsec`, `NostrSecretKey`
- [chat.md](./chat.md) — the image upload that uses the Blossom header
- [push-inbox.md](./push-inbox.md) — the push server these proofs authorize
