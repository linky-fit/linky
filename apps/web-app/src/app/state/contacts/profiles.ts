import type { ProfileMetadata } from "@linky-fit/linkstr";
import { Atom } from "effect/reactivity";
import {
  deriveDefaultLightningAddress,
  deriveDefaultProfile,
  type DerivedProfileDefaults,
} from "../../../derivedProfile";
import { currentNpubAtom } from "../session/session";
import { displayPrefsAtom } from "../shell/displayPrefs";

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

export const profileCacheAtom = Atom.keepAlive(
  Atom.make<ProfileCache>(emptyProfileCache),
);

/** The own profile as last published or watched; the profile composition keeps it current. */
export const myProfileMetadataAtom = Atom.keepAlive(
  Atom.make<ProfileMetadata | null>(null),
);

/** The own profile's fields as last published or watched; null until known. */
export interface MyProfile {
  readonly name: string | null;
  readonly picture: string | null;
  readonly lnAddress: string | null;
  readonly status: string | null;
}

export const myProfileAtom = Atom.keepAlive(
  Atom.make<MyProfile>({
    name: null,
    picture: null,
    lnAddress: null,
    status: null,
  }),
);

/** The npub.cash lightning addresses the identity owns; loading until npub.cash answered. */
export interface OwnedLightningAddresses {
  readonly addresses: readonly string[];
  readonly loading: boolean;
}

export const ownedLightningAddressesAtom = Atom.keepAlive(
  Atom.make<OwnedLightningAddresses>({ addresses: [], loading: true }),
);

export interface EffectiveProfile {
  /** The name, picture and address the identity gets before it publishes a profile. */
  readonly derivedProfile: DerivedProfileDefaults | null;
  readonly defaultLightningAddress: string | null;
  readonly effectiveProfileName: string | null;
  readonly effectiveProfilePicture: string | null;
  readonly effectiveMyLightningAddress: string | null;
}

/** The own profile as shown: published fields, else the identity's defaults. */
export const effectiveProfileAtom = Atom.readable((get): EffectiveProfile => {
  const npub = get(currentNpubAtom);
  const { lang } = get(displayPrefsAtom);
  const my = get(myProfileAtom);
  const derivedProfile = npub ? deriveDefaultProfile(npub, lang) : null;
  const defaultLightningAddress = npub
    ? deriveDefaultLightningAddress(npub)
    : null;
  return {
    derivedProfile,
    defaultLightningAddress,
    effectiveProfileName: my.name ?? derivedProfile?.name ?? null,
    effectiveProfilePicture: my.picture ?? derivedProfile?.pictureUrl ?? null,
    effectiveMyLightningAddress: my.lnAddress ?? defaultLightningAddress,
  };
});

export interface ProfileEditValues {
  readonly lnAddress: string;
  readonly name: string;
  readonly picture: string;
  readonly status: string;
}

/** The profile edit form, kept across navigation like the rest of the shell. */
export interface ProfileDraft extends ProfileEditValues {
  readonly editing: boolean;
  readonly customPictureUrl: string;
  readonly pictureKind: "custom" | "generated";
  readonly saving: boolean;
  /** The values the form opened or last saved with, to tell whether it changed. */
  readonly initial: ProfileEditValues | null;
}

export const profileDraftAtom = Atom.keepAlive(
  Atom.make<ProfileDraft>({
    editing: false,
    name: "",
    lnAddress: "",
    status: "",
    picture: "",
    customPictureUrl: "",
    pictureKind: "generated",
    saving: false,
    initial: null,
  }),
);

/** True while a status currency toggle publishes. */
export const profileStatusSavingAtom = Atom.keepAlive(Atom.make(false));
