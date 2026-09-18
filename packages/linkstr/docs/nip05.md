# NIP-05

NIP-05 maps a human-readable `name@domain` identifier to a pubkey and optional
relay hints via a `/.well-known/nostr.json` document. linkstr owns the protocol
logic — parsing the identifier, building the query url, and decoding the
document into branded types — while the actual HTTPS request stays with the
platform, because linkstr otherwise speaks only the Nostr relay protocol and
holds no HTTP client.

## Functions

`parseNip05Identifier(value, defaultDomain?)` normalizes an input into a
`Nip05Identifier` (`{ localPart, domain, identifier }`) or `null`. It lowercases
and validates the local part and domain, rejects `npub` inputs and malformed
values, and, when the input has no `@domain`, falls back to `defaultDomain` if
one is given (otherwise returns `null`).

`nip05WellKnownUrl(identifier)` returns the `URL` to fetch:
`https://<domain>/.well-known/nostr.json?name=<localPart>`.

`decodeNip05Document(body, identifier)` takes the parsed JSON response and the
identifier and returns `{ pubkey, relays }` — a branded `Pubkey` and a
deduplicated `ReadonlyArray<RelayUrl>` from the document's `relays` map — or
`null` when the name is absent or the pubkey is not valid.

## Resolving

The caller performs the fetch and hands the response to linkstr:

```ts
import {
  decodeNip05Document,
  encodeNpub,
  nip05WellKnownUrl,
  parseNip05Identifier,
} from "@linky/linkstr";

const resolve = async (input: string): Promise<string | null> => {
  const identifier = parseNip05Identifier(input, "example.com");
  if (!identifier) return null;

  const response = await fetch(nip05WellKnownUrl(identifier), {
    headers: { Accept: "application/json" },
    redirect: "manual",
  });
  if (!response.ok) return null;

  const resolution = decodeNip05Document(await response.json(), identifier);
  return resolution ? encodeNpub(resolution.pubkey) : null;
};
```

## Related

- [Identity and keys](./identity-and-keys.md) — `parsePubkey` / `encodeNpub` and the key codecs this builds on
- [Profiles](./profiles.md) — the metadata a resolved pubkey then loads
