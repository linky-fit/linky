import { getConversationKey } from "nostr-tools/nip44";
import { normalizeAudience } from "./audience.js";
import { isRecord } from "./types.js";

/** Where a site serves its domain document, relative to its origin. */
export const DOMAIN_DOCUMENT_PATH = "/.well-known/linkauth.json";

const MAX_NAME_LENGTH = 100;
const MAX_RELAYS = 5;
const MAX_CALLBACKS = 10;
const PUBKEY_PATTERN = /^[0-9a-f]{64}$/;
const PROBE_KEY = new Uint8Array(32).fill(1);

/** What a site published about itself, validated. */
export interface LinkauthDomain {
  name: string;
  /** Absolute URL on the site's origin, or `null`. */
  icon: string | null;
  /** Key (hex) that receives cross-device logins. */
  pubkey: string;
  /** Relays that cross-device logins travel over. */
  relays: string[];
  /** The only pages a signer may return a login to, as normalized URLs. */
  callbacks: string[];
}

/** Why a document was rejected. Stable: safe to log and to switch on. */
export type DomainDocumentProblem =
  | "not-an-object"
  | "bad-version"
  | "bad-name"
  | "bad-icon"
  | "bad-pubkey"
  | "bad-relays"
  | "bad-callbacks";

export type DomainDocumentResult =
  | { ok: true; domain: LinkauthDomain }
  | { ok: false; problem: DomainDocumentProblem };

const urlOn = (origin: string, value: unknown): URL | null => {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.origin === origin && url.username === "" && url.password === ""
      ? url
      : null;
  } catch {
    return null;
  }
};

/**
 * The normalized URL of a login callback: on `origin`, without credentials,
 * query or fragment. `null` for anything else.
 */
export const plainCallback = (origin: string, value: unknown): string | null =>
  typeof value === "string" && !/[?#]/.test(value)
    ? (urlOn(origin, value)?.href ?? null)
    : null;

/** Whether the key is a point on the curve, so encrypting to it cannot fail later. */
const isUsableKey = (value: unknown): value is string => {
  if (typeof value !== "string" || !PUBKEY_PATTERN.test(value)) return false;
  try {
    getConversationKey(PROBE_KEY, value);
    return true;
  } catch {
    return false;
  }
};

const isRelay = (origin: string, value: unknown): value is string => {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    const secure = url.protocol === "wss:";
    const localDev =
      url.protocol === "ws:" && new URL(origin).protocol === "http:";
    return (
      (secure || localDev) &&
      url.username === "" &&
      url.password === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
};

const listOf = <T>(
  value: unknown,
  max: number,
  accept: (item: unknown) => T | null,
): T[] | null => {
  if (!Array.isArray(value) || value.length < 1 || value.length > max) {
    return null;
  }
  const items = value.map(accept);
  return items.every((item) => item !== null) ? items : null;
};

const isName = (value: unknown): value is string =>
  typeof value === "string" &&
  value.trim() !== "" &&
  value.length <= MAX_NAME_LENGTH &&
  // Format characters are refused except the joiners that real names and emoji sequences need.
  !/[\p{Cc}\p{Zl}\p{Zp}]|(?![\u200C\u200D])\p{Cf}/u.test(value);

const fail = (problem: DomainDocumentProblem): DomainDocumentResult => ({
  ok: false,
  problem,
});

/**
 * Validates the parsed JSON of `<origin>/.well-known/linkauth.json`: version
 * 1, a name (not blank, at most 100 UTF-16 units before trimming, no
 * control, line-separator or format characters except ZWNJ and ZWJ; stored
 * trimmed), an optional icon on the origin, a usable `pubkey`, 1 to 5
 * relays (`ws` only for a localhost origin; no credentials or fragment) and 1 to 10 callbacks on the
 * origin without query or fragment. Unknown fields are ignored. Throws
 * `TypeError` when `origin` is not a normalized origin: that is a bug in
 * the caller.
 */
export const parseDomainDocument = (
  value: unknown,
  origin: string,
): DomainDocumentResult => {
  if (normalizeAudience(origin) !== origin) {
    throw new TypeError("linkauth: invalid origin");
  }
  if (!isRecord(value)) return fail("not-an-object");
  if (value.version !== 1) return fail("bad-version");
  const { name, icon, pubkey } = value;
  if (!isName(name)) return fail("bad-name");
  const iconUrl =
    icon === undefined || icon === null ? null : urlOn(origin, icon);
  if (icon !== undefined && icon !== null && iconUrl === null) {
    return fail("bad-icon");
  }
  if (!isUsableKey(pubkey)) return fail("bad-pubkey");
  const relays = listOf(value.relays, MAX_RELAYS, (item) =>
    isRelay(origin, item) ? item : null,
  );
  if (relays === null) return fail("bad-relays");
  const callbacks = listOf(value.callbacks, MAX_CALLBACKS, (item) =>
    plainCallback(origin, item),
  );
  if (callbacks === null) return fail("bad-callbacks");
  return {
    ok: true,
    domain: {
      name: name.trim(),
      icon: iconUrl?.href ?? null,
      pubkey,
      relays,
      callbacks,
    },
  };
};
