import {
  decodeNpub,
  identityFromNsec,
  parsePubkey,
  type NostrSecretKey,
  type Pubkey,
} from "@linky-fit/linkstr";
import { boundedMemo } from "../../../utils/boundedMemo";
import { UNKNOWN_CONTACT_ID_PREFIX } from "../../../utils/constants";
import { normalizeNpubIdentifier } from "../../../utils/nostrNpub";
import type { ContactIdentityRowLike } from "../../types/appTypes";

// A few hundred peers recur across thousands of messages; decoding validates on the curve.
const PUBKEY_MEMO_CAPACITY = 2_000;
const parsePubkeyOnce = boundedMemo(parsePubkey, PUBKEY_MEMO_CAPACITY);

/** `decodeNpub`, decoding each npub once. */
export const decodeNpubOnce = boundedMemo(decodeNpub, PUBKEY_MEMO_CAPACITY);

export const normalizePubkeyHex = (
  value: string | null | undefined,
): Pubkey | null => parsePubkeyOnce((value ?? "").trim().toLowerCase());

// Unknown senders stay out of contacts until the user adds them; the UI
// names their conversations `unknown:<pubkeyHex>`.
export const buildUnknownContactId = (
  pubkeyHex: string | null | undefined,
): string | null => {
  const normalizedPubkey = normalizePubkeyHex(pubkeyHex);
  if (!normalizedPubkey) return null;
  return `${UNKNOWN_CONTACT_ID_PREFIX}${normalizedPubkey}`;
};

const readUnknownPubkeyHex = (
  contact: ContactIdentityRowLike | null,
): Pubkey | null => {
  return normalizePubkeyHex(contact?.unknownPubkeyHex);
};

export const isUnknownContactId = (id: string | null | undefined): boolean => {
  const normalizedId = (id ?? "").trim().toLowerCase();
  if (!normalizedId) return false;
  return normalizedId.startsWith(UNKNOWN_CONTACT_ID_PREFIX);
};

export const readUnknownContactIdPubkey = (
  id: string | null | undefined,
): Pubkey | null => {
  const normalizedId = (id ?? "").trim().toLowerCase();
  if (!normalizedId.startsWith(UNKNOWN_CONTACT_ID_PREFIX)) return null;
  return normalizePubkeyHex(
    normalizedId.slice(UNKNOWN_CONTACT_ID_PREFIX.length),
  );
};

interface ResolvedNostrChatIdentity {
  contactPubHex: string;
  myPubHex: string;
  privBytes: NostrSecretKey;
}

export const resolveNostrChatIdentity = async (
  currentNsec: string,
  contact: ContactIdentityRowLike,
): Promise<ResolvedNostrChatIdentity | null> => {
  const identity = identityFromNsec(currentNsec);
  if (!identity) throw new Error("invalid nsec");

  const unknownPubkeyHex = readUnknownPubkeyHex(contact);
  if (unknownPubkeyHex) {
    return {
      contactPubHex: unknownPubkeyHex,
      myPubHex: identity.pubkey,
      privBytes: identity.secretKey,
    };
  }

  const contactNpub = normalizeNpubIdentifier(contact.npub ?? "");
  if (!contactNpub) return null;

  const contactPubkey = parsePubkey(contactNpub);
  if (!contactPubkey) return null;
  return {
    contactPubHex: contactPubkey,
    myPubHex: identity.pubkey,
    privBytes: identity.secretKey,
  };
};
