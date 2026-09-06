import {
  identityFromNsec,
  parsePubkey,
  type NostrSecretKey,
} from "@linky/linkstr";
import { UNKNOWN_CONTACT_ID_PREFIX } from "../../../utils/constants";
import { normalizeNpubIdentifier } from "../../../utils/nostrNpub";
import type { ContactIdentityRowLike } from "../../types/appTypes";

export const normalizePubkeyHex = (
  value: string | null | undefined,
): string | null => {
  const normalized = (value ?? "").trim().toLowerCase();
  return parsePubkey(normalized);
};

export const buildUnknownContactId = (
  pubkeyHex: string | null | undefined,
): string | null => {
  const normalizedPubkey = normalizePubkeyHex(pubkeyHex);
  if (!normalizedPubkey) return null;
  return `${UNKNOWN_CONTACT_ID_PREFIX}${normalizedPubkey}`;
};

const readUnknownPubkeyHex = (
  contact: ContactIdentityRowLike | null,
): string | null => {
  return normalizePubkeyHex(contact?.unknownPubkeyHex);
};

export const isUnknownContactId = (id: string | null | undefined): boolean => {
  const normalizedId = (id ?? "").trim().toLowerCase();
  if (!normalizedId) return false;
  return normalizedId.startsWith(UNKNOWN_CONTACT_ID_PREFIX);
};

export const readUnknownContactIdPubkey = (
  id: string | null | undefined,
): string | null => {
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
