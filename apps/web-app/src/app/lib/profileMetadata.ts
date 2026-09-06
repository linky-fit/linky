import { ProfileMetadata } from "@linky/linkstr";
import { getDefaultNip05IdentifierFromAddress } from "../../utils/nostrNip05";

export const applyLightningAddressToProfileMetadata = (
  previous: ProfileMetadata,
  lightningAddress: string,
): {
  lightningAddress: string;
  metadata: ProfileMetadata;
  nip05: string | null;
} => {
  const trimmedLightningAddress = lightningAddress.trim();
  const nextNip05 = getDefaultNip05IdentifierFromAddress(
    trimmedLightningAddress,
  );
  const keptNip05 =
    nextNip05 ??
    (getDefaultNip05IdentifierFromAddress(previous.nip05 ?? "")
      ? undefined
      : previous.nip05);

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
    ...(keptNip05 ? { nip05: keptNip05 } : {}),
  });

  return {
    lightningAddress: trimmedLightningAddress,
    metadata,
    nip05: nextNip05,
  };
};
