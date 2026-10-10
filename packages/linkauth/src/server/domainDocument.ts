import { getPublicKey } from "nostr-tools/pure";
import { normalizeAudience } from "../audience.js";
import { parseDomainDocument } from "../domain.js";

/** The JSON a site serves at `/.well-known/linkauth.json`. */
export interface LinkauthDomainDocument {
  version: 1;
  name: string;
  icon?: string;
  pubkey: string;
  relays: string[];
  callbacks: string[];
}

export interface DomainDocumentArgs {
  /** Your site's origin: the document, icon and callbacks all live on it. */
  audience: string;
  name: string;
  /** Absolute URL on your origin. */
  icon?: string;
  /** Public key of the receiving key; see `publicKeyOf`. */
  pubkey: string;
  relays: readonly string[];
  /** Exact return pages for same-device logins, without query or fragment. */
  callbacks: readonly string[];
}

/** The hex public key for a secret key. */
export const publicKeyOf = (secretKey: Uint8Array): string =>
  getPublicKey(secretKey);

/**
 * The document to serve at `/.well-known/linkauth.json`, checked by the
 * rules signers apply. Throws `TypeError` naming the problem, so a bad
 * configuration fails when you build it rather than when a user logs in.
 */
export const domainDocument = (
  args: DomainDocumentArgs,
): LinkauthDomainDocument => {
  const origin = normalizeAudience(args.audience);
  if (origin === null) throw new TypeError("linkauth: invalid audience");
  const document: LinkauthDomainDocument = {
    version: 1,
    name: args.name,
    ...(args.icon === undefined ? {} : { icon: args.icon }),
    pubkey: args.pubkey,
    relays: [...args.relays],
    callbacks: [...args.callbacks],
  };
  const parsed = parseDomainDocument(document, origin);
  if (!parsed.ok) {
    throw new TypeError(`linkauth: invalid domain document: ${parsed.problem}`);
  }
  return document;
};
