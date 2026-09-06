import * as Evolu from "@evolu/common";
import type { ProfileMetadata } from "@linky/linkstr";
import { getBestNostrName } from "../../utils/formatting";
import { normalizeNpubIdentifier } from "../../utils/nostrNpub";
import type { ContactRowLike } from "../types/appTypes";
import { trimString } from "../../utils/validation";

interface ContactPublicProfile {
  lnAddress: string;
  name: string;
}

interface ResolvedContactProfile extends ContactPublicProfile {
  hasLocalLnAddress: boolean;
  hasLocalName: boolean;
  localLnAddress: string;
  localName: string;
}

const readSqliteBool = (value: unknown): boolean => {
  const parsed = Evolu.SqliteBoolean.fromUnknown(value);
  return parsed.ok && parsed.value === Evolu.sqliteTrue;
};

export const getContactPublicProfile = (
  npub: string | null | undefined,
  metadata: ProfileMetadata | null | undefined,
): ContactPublicProfile => {
  const normalizedNpub = normalizeNpubIdentifier(npub ?? "");
  if (!normalizedNpub || !metadata) {
    return { lnAddress: "", name: "" };
  }

  return {
    lnAddress: (metadata.lud16 ?? "").trim() || (metadata.lud06 ?? "").trim(),
    name: getBestNostrName(metadata) ?? "",
  };
};

/**
 * The contact row is the display source of truth: its `name`/`lnAddress`
 * always hold the effective value, and the `*SetByUser` flags say whether
 * that value is a local override or mirrors the Nostr profile. Metadata is
 * consulted only for the public side of an overridden field (edit-form
 * hints, restore).
 */
export const resolveContactProfile = (
  contact: ContactRowLike,
  metadata: ProfileMetadata | null | undefined,
): ResolvedContactProfile => {
  const normalizedNpub = normalizeNpubIdentifier(contact.npub ?? "");
  const storedName = trimString(contact.name);
  const storedLnAddress = trimString(contact.lnAddress);

  if (!normalizedNpub) {
    return {
      hasLocalLnAddress: Boolean(storedLnAddress),
      hasLocalName: Boolean(storedName),
      localLnAddress: storedLnAddress,
      localName: storedName,
      lnAddress: "",
      name: "",
    };
  }

  const hasLocalName = readSqliteBool(contact.nameSetByUser);
  const hasLocalLnAddress = readSqliteBool(contact.lnAddressSetByUser);
  const publicProfile = getContactPublicProfile(normalizedNpub, metadata);

  return {
    hasLocalLnAddress,
    hasLocalName,
    localLnAddress: hasLocalLnAddress ? storedLnAddress : "",
    localName: hasLocalName ? storedName : "",
    lnAddress: hasLocalLnAddress
      ? publicProfile.lnAddress
      : publicProfile.lnAddress || storedLnAddress,
    name: hasLocalName ? publicProfile.name : publicProfile.name || storedName,
  };
};
