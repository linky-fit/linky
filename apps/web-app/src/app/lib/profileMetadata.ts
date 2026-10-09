import { ProfileMetadata } from "@linky-fit/linkstr";
import { getProfileNip05 } from "../../utils/nostrNip05";

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
    ...(previous.name ? { name: previous.name } : {}),
    ...(previous.displayName ? { displayName: previous.displayName } : {}),
    ...(previous.picture ? { picture: previous.picture } : {}),
    ...(previous.about ? { about: previous.about } : {}),
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
