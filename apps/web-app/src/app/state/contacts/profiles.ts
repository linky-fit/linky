import type { ProfileMetadata } from "@linky-fit/linkstr";
import { Atom } from "effect/reactivity";

/** Watch-fed Nostr profile facts per npub; `null` means the profile has none. */
export interface ProfileCache {
  readonly metadataByNpub: Readonly<Record<string, ProfileMetadata | null>>;
  readonly pictureByNpub: Readonly<Record<string, string | null>>;
  readonly statusByNpub: Readonly<Record<string, string | null>>;
}

export const emptyProfileCache: ProfileCache = {
  metadataByNpub: {},
  pictureByNpub: {},
  statusByNpub: {},
};

export const profileCacheAtom = Atom.make<ProfileCache>(emptyProfileCache);

/** The own profile as last published or watched; the profile composition keeps it current. */
export const myProfileMetadataAtom = Atom.make<ProfileMetadata | null>(null);
