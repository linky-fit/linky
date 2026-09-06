# Identity and keys

How strings become keys and how keys become the `LinkstrIdentity` service. You need it at login, when parsing user-entered pubkeys, and when wiring a non-React runtime.

## Codecs

All in `identity/codec.ts`, exported from `@linky/linkstr`. Decoders return `null` on any bad input; nothing throws.

| Function                         | In → Out                                         | Notes                            |
| -------------------------------- | ------------------------------------------------ | -------------------------------- |
| `decodeNsec(str)`                | `nsec1…` → `NostrSecretKey \| null`              | rejects keys outside curve order |
| `encodeNsec(key)`                | `NostrSecretKey` → `nsec1…`                      |                                  |
| `identityFromNsec(str)`          | `nsec1…` → `{ secretKey, pubkey } \| null`       | what login uses                  |
| `derivePubkey(key)`              | `NostrSecretKey` → `Pubkey`                      |                                  |
| `decodeNpub(str)`                | `npub1…` → `Pubkey \| null`                      |                                  |
| `encodeNpub(pubkey)`             | `Pubkey` → `npub1…`                              |                                  |
| `parsePubkey(str)`               | `npub1…` or 64-hex (any case) → `Pubkey \| null` | use for user input               |
| `decodeNprofilePubkey(str)`      | `nprofile1…` → `Pubkey \| null`                  | relay hints are dropped          |
| `encodeNprofile(pubkey, relays)` | → `nprofile1…`                                   | `relays` are plain strings       |

```ts
import { encodeNpub, identityFromNsec, parsePubkey } from "@linky/linkstr";

const login = (nsec: string) => {
  const identity = identityFromNsec(nsec.trim());
  if (identity === null) throw new Error("not an nsec");
  return { ...identity, npub: encodeNpub(identity.pubkey) };
};

const peerFromInput = (raw: string) => parsePubkey(raw.trim()); // Pubkey | null
```

## Validation

The codecs validate cryptographic keys, not just their length: `parsePubkey`, `decodeNpub`, `Pubkey.make`, and `Schema.is(Pubkey)` all reject a 64-hex string that is not a valid public key, and `NostrSecretKey` requires bytes a public key can be derived from. If you keep pubkeys as plain strings in storage, revalidate them with `Schema.is(Pubkey)` before building a draft, so a corrupt value fails at the boundary rather than inside a send or an unwrap.

## `LinkstrIdentity`

The service every signing and unwrapping path reads: `{ pubkey, secretKey }`. Build it with `LinkstrIdentity.fromSecretKey(secretKey)`; `linkstrServices`, `runLinkstr`, and the react runtime do this for you from `config.secretKey`.

```ts
import { Effect } from "effect";
import { LinkstrIdentity } from "@linky/linkstr";

const whoAmI = Effect.map(LinkstrIdentity, (identity) => identity.pubkey);
```

Read `pubkey` from it when a vertical needs "me" (for example to tell an own echo from a peer fact). Do not copy `secretKey` anywhere else, and never put it, an nsec, or seed words into inspector events or logs ([inspector.md](./inspector.md#the-no-key-material-rule)).

Identity is fixed for the lifetime of a runtime. To switch accounts, build a new runtime: `runLinkstr` does that per call, and linkstr-react rebuilds when `linkstrConfigAtom` changes ([react.md](./react.md#identity-switches)). The outbox refuses jobs stored under another pubkey ([outbox.md](./outbox.md)).

## `nostr-tools` stays inside linkstr

Consumers never import `nostr-tools`: the codecs above cover every key operation, the verticals cover every event, and `SignedPlainEvent` is exported for the HTTP-auth payloads that must be serialized. The [package README](../README.md) explains why.

## Related

- [concepts.md](./concepts.md#branded-primitives)
- [http-auth.md](./http-auth.md) — signing events used as HTTP credentials
- [testing.md](./testing.md) — `makeIdentity` for throwaway keys
