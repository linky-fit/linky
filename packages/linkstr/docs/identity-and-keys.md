# Identity and keys

How strings become keys and how keys become the `LinkstrIdentity` service. You need it at login, when parsing user-entered pubkeys, and when wiring a non-React runtime.

## Codecs

The decoders (`decodeNsec`, `decodeNpub`, `decodeNprofilePubkey`, `parsePubkey`, `identityFromNsec`) return `null` on any bad input; nothing throws. `parsePubkey` accepts `npub1…` or 64-hex in any case, so use it for user input. The encoders (`encodeNsec`, `encodeNpub`, `encodeNprofile`) and `derivePubkey` take already-branded values and cannot fail. Consumers never import `nostr-tools`: these codecs cover every key operation, the verticals cover every event, and `SignedPlainEvent` is exported for the HTTP-auth payloads that must be serialized.

```ts
import { encodeNpub, identityFromNsec, parsePubkey } from "@linky-fit/linkstr";

const login = (nsec: string) => {
  const identity = identityFromNsec(nsec.trim());
  if (identity === null) throw new Error("not an nsec");
  return { ...identity, npub: encodeNpub(identity.pubkey) };
};

const peerFromInput = (raw: string) => parsePubkey(raw.trim()); // Pubkey | null
```

`deriveConversationKey(secretKey, pubkey)` returns the 32-byte NIP-44 conversation key of a pair; both sides derive the same bytes without exchanging anything, so apps can feed it to a KDF for a pairwise secret of their own. Treat it like the secret key: never log it or put it in an inspector event.

The codecs validate cryptographic keys, not just their length: `parsePubkey`, `decodeNpub`, `Pubkey.make` and `Schema.is(Pubkey)` all reject a 64-hex string that is not a point on the curve, and `NostrSecretKey` requires bytes a public key can be derived from. If you keep pubkeys as plain strings in storage, revalidate them with `Schema.is(Pubkey)` before building a draft, so a corrupt value fails at the boundary rather than inside a send or an unwrap.

## `LinkstrIdentity`

The service every signing and unwrapping path reads: `{ pubkey, secretKey }`. Build it with `LinkstrIdentity.fromSecretKey(secretKey)`; `linkstrServices`, `runLinkstr` and the React runtime do this for you from `config.secretKey`.

```ts
import { Effect } from "effect";
import { LinkstrIdentity } from "@linky-fit/linkstr";

const whoAmI = Effect.map(LinkstrIdentity, (identity) => identity.pubkey);
```

Read `pubkey` from it when you need "me" (for example to tell an own echo from a peer fact). Do not copy `secretKey` anywhere else, and never put it, an nsec or seed words into logs or inspector events ([diagnostics.md](./diagnostics.md#what-the-inspector-never-contains)).

Identity is fixed for the lifetime of a runtime. To switch accounts, build a new runtime: `runLinkstr` does that per call, and linkstr-react rebuilds when `linkstrConfigAtom` changes ([react.md](./react.md#identity-switches)). The outbox refuses jobs stored under another pubkey ([outbox.md](./outbox.md#retry-and-ordering)).
