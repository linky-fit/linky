import type {
  PlainEventReceipt,
  ProfileFetchResult,
  ProfileMetadata,
  Pubkey,
} from "@linky-fit/linkstr";
import { Exit } from "effect";
import { reportAppLog } from "../../devtools/inspector/appLog";
import { saveCachedProfile } from "../../profileCache";
import { nowSeconds } from "../../utils/time";
import { profileMetadataForNewKey } from "./profileMetadata";

interface CarryProfileToNewKeyArgs {
  fetchProfile: (
    pubkey: Pubkey,
  ) => Promise<Exit.Exit<ProfileFetchResult, unknown>>;
  newNpub: string;
  newPubkey: Pubkey;
  previousMetadata: ProfileMetadata;
  previousNpub: string | null;
  publishProfile: (
    metadata: ProfileMetadata,
  ) => Promise<Exit.Exit<PlainEventReceipt, unknown>>;
}

const reportPublishSkipped = (
  newPubkey: Pubkey,
  reason: "existing-profile" | "fetch-failed",
): void =>
  reportAppLog({
    tag: "profile.keySwitchPublishSkipped",
    summary:
      reason === "existing-profile"
        ? "Kept the new key's existing profile"
        : "No relay answered for the new key's profile; published nothing",
    links: { pubkey: newPubkey },
    payload: { reason },
  });

/**
 * Publishes the previous key's profile for a new key that has none on
 * relays. A profile the new key already has stays untouched, and so does an
 * unknown one: when the fetch fails, nothing is published. Resolves false
 * only when the publish itself failed.
 */
export const carryProfileToNewKey = async ({
  fetchProfile,
  newNpub,
  newPubkey,
  previousMetadata,
  previousNpub,
  publishProfile,
}: CarryProfileToNewKeyArgs): Promise<boolean> => {
  const existingExit = await fetchProfile(newPubkey);
  if (Exit.isFailure(existingExit)) {
    reportPublishSkipped(newPubkey, "fetch-failed");
    return true;
  }

  const existing = existingExit.value.profile;
  if (existing) {
    saveCachedProfile(newNpub, existing.metadata, existing.updatedAt);
    reportPublishSkipped(newPubkey, "existing-profile");
    return true;
  }

  const metadata = profileMetadataForNewKey(
    previousMetadata,
    previousNpub,
    newNpub,
  );
  const publishExit = await publishProfile(metadata);
  if (Exit.isFailure(publishExit)) return false;

  saveCachedProfile(newNpub, metadata, nowSeconds());
  return true;
};
