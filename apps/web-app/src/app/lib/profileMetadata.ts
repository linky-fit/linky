import { ProfileMetadata } from "@linky-fit/linkstr";
import { Struct } from "effect";
import { deriveDefaultLightningAddress } from "../../derivedProfile";
import {
  getProfileNip05,
  isNpubDefaultNip05,
  parseDefaultDomainLocalPart,
} from "../../utils/nostrNip05";

export const applyLightningAddressToProfileMetadata = (
  previous: ProfileMetadata,
  lightningAddress: string,
): {
  lightningAddress: string;
  metadata: ProfileMetadata;
} => {
  const trimmedLightningAddress = lightningAddress.trim();
  const nip05 = getProfileNip05(trimmedLightningAddress, previous.nip05);

  const metadata = new ProfileMetadata({
    ...Struct.omit(previous, "lud16", "lud06", "nip05"),
    ...(trimmedLightningAddress
      ? {
          lud16: trimmedLightningAddress,
          ...(previous.lud06 ? { lud06: previous.lud06 } : {}),
        }
      : {}),
    ...(nip05 ? { nip05 } : {}),
  });

  return {
    lightningAddress: trimmedLightningAddress,
    metadata,
  };
};

/** The profile without its `npub…@linky.fit` nip05; null when it has none to drop. */
export const dropNpubNip05 = (
  metadata: ProfileMetadata,
): ProfileMetadata | null =>
  metadata.nip05 && isNpubDefaultNip05(metadata.nip05)
    ? new ProfileMetadata(Struct.omit(metadata, "nip05"))
    : null;

// A linky.fit address, bought name included, belongs to the npub.cash account
// of the key that signs for it, so it does not follow a key change.
const isAccountAddressOf = (lud16: string, npub: string | null): boolean => {
  const localPart = parseDefaultDomainLocalPart(lud16);
  if (localPart === null) return false;
  return !localPart.startsWith("npub1") || localPart === npub?.toLowerCase();
};

/** The previous key's profile as the new key publishes it. */
export const profileMetadataForNewKey = (
  metadata: ProfileMetadata,
  previousNpub: string | null,
  newNpub: string,
): ProfileMetadata => {
  const lud16 =
    metadata.lud16 && isAccountAddressOf(metadata.lud16, previousNpub)
      ? deriveDefaultLightningAddress(newNpub)
      : metadata.lud16;
  const nip05 = getProfileNip05(lud16 ?? "", metadata.nip05);

  return new ProfileMetadata({
    ...Struct.omit(metadata, "lud16", "nip05"),
    ...(lud16 ? { lud16 } : {}),
    ...(nip05 ? { nip05 } : {}),
  });
};
