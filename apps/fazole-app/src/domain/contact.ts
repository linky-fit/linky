import { parsePubkey, type Pubkey } from "@linky-fit/linkstr";
import { Option, Schema } from "effect";
import { parsePubkeyInput } from "./withdrawTarget";

/** Where a name without a domain lives: `hynek` is `hynek@linky.fit`. */
export const DEFAULT_CONTACT_DOMAIN = "linky.fit";

const NAME = /^[a-z0-9._-]+$/iu;
const DOMAIN = /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/iu;

/** What the merchant typed as a contact: a key, or a NIP-05 name to look up. */
export type ContactInput =
  | { readonly kind: "pubkey"; readonly pubkey: Pubkey }
  | {
      readonly kind: "nip05";
      readonly name: string;
      readonly domain: string;
      /** `name@domain`, lower-cased. */
      readonly address: string;
    };

/**
 * Reads a contact: an npub, nprofile or Linky profile link names a key
 * outright; `jmeno` or `jmeno@domena.cz` names a NIP-05 address, on
 * linky.fit when no domain is given. `null` for anything else.
 */
export const parseContactInput = (text: string): ContactInput | null => {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const pubkey = parsePubkeyInput(trimmed);
  if (pubkey !== null) return { kind: "pubkey", pubkey };
  const at = trimmed.indexOf("@");
  const name = (at < 0 ? trimmed : trimmed.slice(0, at)).toLowerCase();
  const domain = (
    at < 0 ? DEFAULT_CONTACT_DOMAIN : trimmed.slice(at + 1)
  ).toLowerCase();
  if (!NAME.test(name) || !DOMAIN.test(domain) || /^npub1/u.test(name)) {
    return null;
  }
  return { kind: "nip05", name, domain, address: `${name}@${domain}` };
};

/** The URL a NIP-05 lookup fetches. */
export const nip05Url = (input: Extract<ContactInput, { kind: "nip05" }>) =>
  `https://${input.domain}/.well-known/nostr.json?name=${encodeURIComponent(input.name)}`;

/** NIP-05: the names a domain vouches for, whatever else the document holds. */
export const Nip05Document = Schema.Struct({
  names: Schema.Record(Schema.String, Schema.Unknown),
});
export type Nip05Document = typeof Nip05Document.Type;

/** The `nostr.json` body as fetched; `null` when it is not one. */
export const readNip05Document = (body: unknown): Nip05Document | null =>
  Option.getOrNull(Schema.decodeUnknownOption(Nip05Document)(body));

/** The key the document names for `name`; `null` when it does not. */
export const readNip05Response = (
  body: unknown,
  name: string,
): Pubkey | null => {
  const value = readNip05Document(body)?.names[name];
  return typeof value === "string" ? parsePubkey(value.toLowerCase()) : null;
};
