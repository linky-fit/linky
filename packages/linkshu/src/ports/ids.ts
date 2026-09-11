import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/**
 * A deterministic store id for adapters without an id scheme of their own:
 * the same key always yields the same id, and the key (a proof secret, a
 * token text) never appears in it.
 */
export const deriveStoreId = (key: string): string =>
  bytesToHex(sha256(new TextEncoder().encode(key))).slice(0, 32);
