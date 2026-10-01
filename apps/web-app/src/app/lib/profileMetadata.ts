import { ProfileMetadata } from "@linky-fit/linkstr";
import { Struct } from "effect";
import { getProfileNip05, isNpubDefaultNip05 } from "../../utils/nostrNip05";

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
    ...Struct.omit(previous, ["lud16", "lud06", "nip05"]),
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
    ? new ProfileMetadata(Struct.omit(metadata, ["nip05"]))
    : null;
