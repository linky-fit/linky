import {
  ProfileMetadata,
  type ProfileFetchResult,
  type Pubkey,
} from "@linky-fit/linkstr";
import { Exit, Struct } from "effect";
import { deriveDefaultLightningAddress } from "../../derivedProfile";
import { reportAppLog } from "../../devtools/inspector/appLog";
import { getProfileNip05 } from "../../utils/nostrNip05";

/** What relays hold for an identity the user is about to switch to. */
export type IdentityProfileCheck =
  | { kind: "none" }
  | { kind: "found"; metadata: ProfileMetadata }
  | { kind: "unchecked" };

/** A pasted custom identity, or the identity the recovery seed derives. */
export type IdentitySwitchTarget = "custom" | "default";

/** Whose name, picture and about the switched-to identity publishes. */
export type IdentityProfileSource = "linky" | "nostr";

export interface IdentitySwitchCheck {
  check: IdentityProfileCheck;
  /** The identity's own Linky address: its bought name, else its npub address. */
  lightningAddress: string;
}

/**
 * Checks, before anything is switched, which profile the identity already has
 * and whether it bought a linky.fit name. A failed profile fetch leaves the
 * profile unchecked; a failed name lookup falls back to the npub address.
 */
export const checkIdentityForSwitch = async ({
  fetchProfile,
  lookupOwnedAddress,
  npub,
  pubkey,
  target,
}: {
  fetchProfile: (
    pubkey: Pubkey,
  ) => Promise<Exit.Exit<ProfileFetchResult, unknown>>;
  lookupOwnedAddress: () => Promise<string | null>;
  npub: string;
  pubkey: Pubkey;
  target: IdentitySwitchTarget;
}): Promise<IdentitySwitchCheck> => {
  const [profileExit, ownedAddress] = await Promise.all([
    fetchProfile(pubkey),
    lookupOwnedAddress().then(
      (address) => ({ address, failed: false }),
      () => ({ address: null, failed: true }),
    ),
  ]);
  const profile = Exit.isSuccess(profileExit)
    ? profileExit.value.profile
    : null;
  const check: IdentityProfileCheck = Exit.isFailure(profileExit)
    ? { kind: "unchecked" }
    : profile
      ? { kind: "found", metadata: profile.metadata }
      : { kind: "none" };
  const boughtName = ownedAddress.failed
    ? "lookup-failed"
    : ownedAddress.address === null
      ? "none"
      : "found";

  reportAppLog({
    tag: "identitySwitch.profileChecked",
    summary: `Identity to switch to: profile ${check.kind}, bought name ${boughtName}`,
    links: { pubkey },
    payload: { boughtName, profile: check.kind, target },
  });
  return {
    check,
    lightningAddress:
      ownedAddress.address ?? deriveDefaultLightningAddress(npub),
  };
};

/**
 * The profile an identity publishes when the user switches to it. `source`
 * picks the name, picture and about; fields Linky does not model come from
 * the identity's own profile when it has one. The Linky address always wins,
 * and the handle is the bought name or a handle of another domain the
 * identity already published.
 */
export const profileForIdentitySwitch = ({
  lightningAddress,
  linkyProfile,
  nostrProfile,
  source,
}: {
  lightningAddress: string;
  linkyProfile: ProfileMetadata;
  nostrProfile: ProfileMetadata | null;
  source: IdentityProfileSource;
}): ProfileMetadata => {
  const shown =
    source === "nostr" && nostrProfile ? nostrProfile : linkyProfile;
  const extraFields = (nostrProfile ?? linkyProfile).extraFields;
  const nip05 = getProfileNip05(lightningAddress, nostrProfile?.nip05);

  return new ProfileMetadata({
    ...Struct.omit(shown, ["extraFields", "lud06", "lud16", "nip05"]),
    lud16: lightningAddress,
    ...(nip05 ? { nip05 } : {}),
    ...(extraFields ? { extraFields } : {}),
  });
};
