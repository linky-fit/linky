import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import {
  safeLocalStorageGet,
  safeLocalStorageKeys,
  safeLocalStorageRemove,
  tryLocalStorageSet,
} from "./storage";

/**
 * Tokens Linky's npub.cash server handed out, each only once: kept on this
 * device from the claim until a receive settles them, so a receive that never
 * got its turn, or a tab closed mid-receive, loses nothing.
 * Each token is its own entry, so tabs adding and removing tokens at once
 * never write over each other's. An entry's key is its token's SHA-256,
 * since diagnostics list storage keys and a token is spendable.
 */
const entryPrefix = (inboxKey: string): string => `${inboxKey}.`;

const entryKey = (inboxKey: string, token: string): string =>
  entryPrefix(inboxKey) + bytesToHex(sha256(utf8ToBytes(token)));

export const readClaimInbox = (inboxKey: string): readonly string[] =>
  safeLocalStorageKeys()
    .filter((key) => key.startsWith(entryPrefix(inboxKey)))
    .flatMap((key) => safeLocalStorageGet(key) || []);

/** Returns the tokens storage refused, which the inbox does not keep. */
export const addToClaimInbox = (
  inboxKey: string,
  tokens: readonly string[],
): readonly string[] =>
  tokens.filter(
    (token) => !tryLocalStorageSet(entryKey(inboxKey, token), token),
  );

export const removeFromClaimInbox = (inboxKey: string, token: string): void => {
  safeLocalStorageRemove(entryKey(inboxKey, token));
};
