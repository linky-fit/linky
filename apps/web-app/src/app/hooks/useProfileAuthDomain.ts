import { navigateTo } from "../../hooks/useRouting";
import {
  appOwnerFromMnemonic,
  NonEmptyString100,
  NonEmptyString1000,
  PositiveInt,
  type IdentityRepository,
  type InboxCursorsRepository,
} from "@linky-fit/linksync";
import React from "react";
import {
  buildLoreleiAvatarUrl,
  deriveDefaultProfile,
} from "../../derivedProfile";
import {
  decodeNsec,
  derivePubkey,
  encodeNpub,
  ProfileMetadata,
  StatusDraft,
} from "@linky-fit/linkstr";
import {
  linkstrConfigAtom,
  useAtom,
  useAtomSet,
  useAtomValue,
  useLinkstrCommands,
} from "@linky-fit/linkstr-react";
import { Cause, Exit, Option } from "effect";
import type { Lang } from "../../i18n";
import {
  loadCachedProfile,
  saveCachedProfile,
  saveCachedStatus,
} from "../../profileCache";
import { recommendedNostrRelays } from "../../utils/nostrRelays";
import { readClipboardText } from "../../platform/clipboard";
import {
  clearIdentitySecrets,
  persistIdentitySecrets,
  readStoredAttachedNsec,
  readStoredCashuMnemonic,
  readStoredSlip39Seed,
  removeStoredAttachedNsec,
  writeStoredAttachedNsec,
  writeStoredCashuMnemonic,
} from "../../platform/identitySecrets";
import { reportAppLog } from "../../devtools/inspector/appLog";
import { markAwaitingFirstHydration } from "@linky-fit/linksync/evolu";
import { markLogoutPending } from "../../platform/logoutWipe";
import { stopBeaconForIdentityChange } from "../lib/beaconStore";
import { triggerPasswordManagerSeedSave } from "../../platform/passwordManager";
import { CASHU_ONBOARDING_SET_MAIN_MINT_STORAGE_KEY } from "../../utils/constants";
import { getDefaultNip05IdentifierFromAddress } from "../../utils/nostrNip05";
import {
  analyzeSlip39Words,
  emptySlip39Words,
  fillSlip39Words,
  normalizeSlip39Input,
  slip39WordsToInput,
} from "../../utils/slip39Input";
import {
  createSlip39Seed,
  deriveCashuBip85MnemonicFromSlip39,
  deriveEvoluOwnerMnemonicFromSlip39,
  deriveNostrKeysFromSlip39,
} from "../../utils/slip39Nostr";
import { looksLikeSlip39Share } from "@linky-fit/identity";
import { myProfileMetadataAtom } from "../state/contacts/profiles";
import {
  attachedNpubAtom,
  attachedNsecAtom,
  defaultNpubAtom,
  defaultNsecAtom,
  logoutArmedAtom,
  nostrIdentitySourceAtom,
  pendingIdentitySwitchAtom,
  seedMnemonicAtom,
  slip39SeedAtom,
  type NostrIdentitySource,
  type PendingIdentitySwitch,
} from "../state/session/identity";
import { currentNpubAtom } from "../state/session/session";
import { useMessagesCommands } from "./messages/useMessagesCommands";
import { buildLinkstrConfig } from "./useLinkstrConfigSync";
import { clearLegacyLaneStorage } from "../migrations/laneToShardMigration";
import { runWrite } from "../lib/storeWrite";
import { localStorageKv, safeLocalStorageSet } from "../../utils/storage";
import type { FilePickerHandle } from "../../utils/pickFile";
import { nowSeconds } from "../../utils/time";
import { prepareProfilePicture } from "../lib/profilePicture";
import {
  checkIdentityForSwitch,
  profileForIdentitySwitch,
  type IdentityProfileSource,
  type IdentitySwitchTarget,
} from "../lib/keySwitchProfile";
import { fetchOwnedLightningAddress } from "../../utils/npubCashInfo";
import type { I18nKey, Translate } from "../../i18n";

export type { NostrIdentitySource };

export interface PendingOnboardingProfile {
  error: string | null;
  kind: "profile";
  name: string;
  npub: string;
  nsec: string;
  pictureUrl: string;
  selectedPictureKind: "custom" | "generated";
  slip39Seed: string;
}

/**
 * A custom identity the user asked to switch to: Linky first checks its
 * profile, then either switches right away or waits for the user's choice.
 */
export type { PendingIdentitySwitch };

export interface ReturningOnboardingStep {
  error: string | null;
  kind: "returning";
  /** One slot per SLIP-39 word, empty until typed or pasted. */
  words: readonly string[];
}

interface PreparingOnboardingStep {
  derivedName: string | null;
  error: string | null;
  kind: "preparing";
  step: 1 | 2;
}

export type OnboardingStep =
  | PreparingOnboardingStep
  | PendingOnboardingProfile
  | ReturningOnboardingStep
  | null;

interface PersistNewProfileParams {
  lnAddress: string;
  name: string;
  npub: string;
  nsec: string;
  pictureUrl: string;
}

interface UseProfileAuthDomainParams {
  currentNsec: string | null;
  /** Null outside an authenticated session; the identity mirror is then not written. */
  identityRepository: IdentityRepository | null;
  /** Null outside an authenticated session, like `identityRepository`. */
  inboxCursors: InboxCursorsRepository | null;
  lang: Lang;
  pushToast: (message: string) => void;
  t: Translate;
}

interface UseProfileAuthDomainResult {
  answerPendingIdentitySwitch: (
    source: IdentityProfileSource | null,
  ) => Promise<void>;
  /** The custom identity kept on this device, in use or not. */
  attachedIdentityNpub: string | null;
  /** Whether a custom identity is active, so the seed's own identity can be switched back to. */
  canSwitchToDefaultIdentity: boolean;
  /** The npub the recovery seed derives, once derived. */
  derivedIdentityNpub: string | null;
  nostrIdentitySource: NostrIdentitySource;
  pendingIdentitySwitch: PendingIdentitySwitch | null;
  switchToAttachedIdentity: () => Promise<void>;
  switchToDefaultIdentity: () => Promise<void>;
  confirmPendingOnboardingProfile: () => Promise<void>;
  createNewAccount: () => Promise<void>;
  currentNpub: string | null;
  isSeedLogin: boolean;
  logoutArmed: boolean;
  onboardingIsBusy: boolean;
  onboardingPhotoInputRef: React.RefObject<FilePickerHandle | null>;
  onboardingStep: OnboardingStep;
  openReturningOnboarding: () => void;
  onPendingOnboardingPhotoError: (error: unknown) => void;
  onPendingOnboardingPhotoSelected: (dataUrl: string) => void;
  pasteReturningSlip39: (text: string, fromIndex: number) => number;
  pasteReturningSlip39FromClipboard: () => Promise<void>;
  pickPendingOnboardingPhoto: () => Promise<void>;
  /** Forgets the attached custom identity; refused while it is in use. */
  removeAttachedIdentity: () => Promise<void>;
  requestPasteNostrKeys: () => Promise<void>;
  requestLogout: (options: { evoluConnected: boolean }) => void;
  savePendingOnboardingBackupToPasswordManager: () => Promise<void>;
  seedMnemonic: string | null;
  shufflePendingOnboardingAvatar: () => void;
  cashuSeedMnemonic: string | null;
  slip39Seed: string | null;
  setReturningSlip39Words: (words: readonly string[]) => void;
  setOnboardingStep: React.Dispatch<React.SetStateAction<OnboardingStep>>;
  setPendingOnboardingName: (value: string) => void;
  submitReturningSlip39: (inputOverride?: string) => Promise<void>;
}

export const useProfileAuthDomain = ({
  currentNsec,
  identityRepository,
  inboxCursors,
  lang,
  pushToast,
  t,
}: UseProfileAuthDomainParams): UseProfileAuthDomainResult => {
  const currentNpub = useAtomValue(currentNpubAtom);
  const myProfileMetadata = useAtomValue(myProfileMetadataAtom);
  const messagesCommands = useMessagesCommands();
  const [onboardingIsBusy, setOnboardingIsBusy] = React.useState(false);
  const [onboardingStep, setOnboardingStep] =
    React.useState<OnboardingStep>(null);
  const [cashuSeedMnemonic, setCashuSeedMnemonic] = React.useState<
    string | null
  >(null);
  const [slip39Seed, setSlip39Seed] = useAtom(slip39SeedAtom);
  const seedMnemonic = useAtomValue(seedMnemonicAtom);
  const [activeNostrIdentitySource, setActiveNostrIdentitySource] = useAtom(
    nostrIdentitySourceAtom,
  );
  const [logoutArmed, setLogoutArmed] = useAtom(logoutArmedAtom);
  const [pendingIdentitySwitch, setPendingIdentitySwitch] = useAtom(
    pendingIdentitySwitchAtom,
  );
  const [defaultNsec, setDefaultNsec] = useAtom(defaultNsecAtom);
  const [defaultNpub, setDefaultNpub] = useAtom(defaultNpubAtom);
  const [attachedNsec, setAttachedNsec] = useAtom(attachedNsecAtom);
  const [attachedNpub, setAttachedNpub] = useAtom(attachedNpubAtom);
  const cancelIdentityCheckRef = React.useRef<(() => void) | null>(null);
  const onboardingPhotoInputRef = React.useRef<FilePickerHandle | null>(null);
  const [isSeedLogin, setIsSeedLogin] = React.useState(false);
  const setLinkstrConfig = useAtomSet(linkstrConfigAtom);
  const { publishProfile, publishStatus, fetchProfile } = useLinkstrCommands();

  React.useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [storedCashuMnemonic, storedSlip39Seed, storedAttachedNsec] =
        await Promise.all([
          readStoredCashuMnemonic(),
          readStoredSlip39Seed(),
          readStoredAttachedNsec(),
        ]);

      if (cancelled) return;
      setCashuSeedMnemonic(storedCashuMnemonic);
      setSlip39Seed(storedSlip39Seed);
      setIsSeedLogin(Boolean(storedSlip39Seed));
      setAttachedNsec(storedAttachedNsec?.trim() || null);
    })();

    return () => {
      cancelled = true;
    };
  }, [setAttachedNsec, setSlip39Seed]);
  const decodeNsecPrivateBytes = React.useCallback(async (nsec: string) => {
    const raw = nsec.trim();
    if (!raw) return null;

    return decodeNsec(raw);
  }, []);

  const deriveNpubFromNsec = React.useCallback(
    async (nsec: string): Promise<string | null> => {
      const privBytes = await decodeNsecPrivateBytes(nsec);
      return privBytes ? encodeNpub(derivePubkey(privBytes)) : null;
    },
    [decodeNsecPrivateBytes],
  );

  const upsertActiveNostrIdentity = React.useCallback(
    async (
      nsec: string,
      source: NostrIdentitySource,
      switchedAtSec: number | null,
    ): Promise<void> => {
      if (!identityRepository) return;
      const npub = await deriveNpubFromNsec(nsec);
      const nsecText = NonEmptyString1000.from(nsec);
      const npubText = npub ? NonEmptyString1000.from(npub) : null;
      const switchedAt =
        switchedAtSec === null ? null : PositiveInt.from(switchedAtSec);
      if (!nsecText.ok || !npubText?.ok || switchedAt?.ok === false) return;

      await runWrite(
        identityRepository.set({
          nsec: nsecText.value,
          npub: npubText.value,
          source: NonEmptyString100.orThrow(source),
          switchedAtSec: switchedAt?.value ?? null,
        }),
      );
    },
    [deriveNpubFromNsec, identityRepository],
  );

  const deriveAppMnemonicFromSlip39 = React.useCallback(
    async (seed: string): Promise<string | null> => {
      const normalizedSeed = seed.trim();
      if (!normalizedSeed) return null;

      const metaMnemonic = await deriveEvoluOwnerMnemonicFromSlip39(
        normalizedSeed,
        "meta",
        0,
      );
      if (!metaMnemonic || appOwnerFromMnemonic(metaMnemonic) === null)
        return null;
      return metaMnemonic;
    },
    [],
  );

  React.useEffect(() => {
    const normalizedSeed = (slip39Seed ?? "").trim();
    if (!normalizedSeed) {
      setDefaultNsec(null);
      setDefaultNpub(null);
      return;
    }

    let cancelled = false;
    void deriveNostrKeysFromSlip39(normalizedSeed).then((derived) => {
      if (cancelled) return;
      setDefaultNsec(derived?.nsec.trim() || null);
      setDefaultNpub(derived?.npub.trim() || null);
    });
    return () => {
      cancelled = true;
    };
  }, [slip39Seed, setDefaultNpub, setDefaultNsec]);

  React.useEffect(() => {
    if (!isSeedLogin) return;
    if (cashuSeedMnemonic) return;

    const normalizedSlip39 = (slip39Seed ?? "").trim();
    if (!normalizedSlip39) return;

    let cancelled = false;
    void (async () => {
      const derived =
        await deriveCashuBip85MnemonicFromSlip39(normalizedSlip39);
      if (!derived || cancelled) return;

      setCashuSeedMnemonic(derived);
      await writeStoredCashuMnemonic(derived);
    })();

    return () => {
      cancelled = true;
    };
  }, [cashuSeedMnemonic, isSeedLogin, slip39Seed]);

  const updatePendingOnboardingProfile = React.useCallback(
    (
      update: (profile: PendingOnboardingProfile) => PendingOnboardingProfile,
    ) => {
      setOnboardingStep((current) => {
        if (!current || current.kind !== "profile") return current;
        return update(current);
      });
    },
    [],
  );

  const updateReturningOnboardingStep = React.useCallback(
    (update: (step: ReturningOnboardingStep) => ReturningOnboardingStep) => {
      setOnboardingStep((current) => {
        if (!current || current.kind !== "returning") return current;
        return update(current);
      });
    },
    [],
  );

  const publishNewProfileMetadata = React.useCallback(
    async ({
      lnAddress,
      name,
      npub,
      nsec,
      pictureUrl,
    }: PersistNewProfileParams) => {
      if (currentNsec) {
        throw new Error(t("onboardingCreateFailed"));
      }

      const trimmedLnAddress = lnAddress.trim();
      const nip05 = getDefaultNip05IdentifierFromAddress(trimmedLnAddress);
      const trimmedName = name.trim();
      const trimmedPicture = await prepareProfilePicture(pictureUrl, nsec);
      const metadata = new ProfileMetadata({
        ...(trimmedName ? { name: trimmedName, displayName: trimmedName } : {}),
        ...(trimmedLnAddress ? { lud16: trimmedLnAddress } : {}),
        ...(nip05 ? { nip05 } : {}),
        ...(trimmedPicture ? { picture: trimmedPicture } : {}),
      });

      const config = buildLinkstrConfig(
        nsec,
        recommendedNostrRelays(),
        inboxCursors,
      );
      if (config === null) {
        throw new Error(t("onboardingCreateFailed"));
      }

      setLinkstrConfig(config);
      const publishExit = await publishProfile(metadata);
      if (Exit.isFailure(publishExit)) {
        const failure = Cause.findErrorOption(publishExit.cause);
        throw new Error("nostr publish failed", {
          cause: Option.isSome(failure) ? failure.value : publishExit.cause,
        });
      }

      saveCachedProfile(npub, metadata, nowSeconds());

      // Contact suggestions discover new users by their kind-30315 status,
      // so publish an empty one right away; failure only costs discovery
      // visibility, not the account, so it does not abort onboarding.
      const statusExit = await publishStatus(new StatusDraft({ content: "" }));
      if (Exit.isSuccess(statusExit)) {
        saveCachedStatus(npub, "", nowSeconds());
      }
    },
    [
      currentNsec,
      inboxCursors,
      publishProfile,
      publishStatus,
      setLinkstrConfig,
      t,
    ],
  );

  const publishProfileForNewKey = React.useCallback(
    async (newNsec: string, metadata: ProfileMetadata): Promise<boolean> => {
      const previousNsec = (currentNsec ?? "").trim();
      const newNpub = await deriveNpubFromNsec(newNsec);
      const config = buildLinkstrConfig(
        newNsec,
        recommendedNostrRelays(),
        inboxCursors,
      );
      if (!newNpub || config === null) return false;

      setLinkstrConfig(config);
      const publishExit = await publishProfile(metadata);
      if (Exit.isFailure(publishExit)) {
        // Hand the runtime back to the still-active identity before bailing.
        setLinkstrConfig(
          buildLinkstrConfig(
            previousNsec,
            recommendedNostrRelays(),
            inboxCursors,
          ),
        );
        return false;
      }

      saveCachedProfile(newNpub, metadata, nowSeconds());
      return true;
    },
    [
      currentNsec,
      deriveNpubFromNsec,
      inboxCursors,
      publishProfile,
      setLinkstrConfig,
    ],
  );

  const setIdentityFromNsecAndReload = React.useCallback(
    async (
      nsec: string,
      sourceSlip39Seed: string,
      options?: {
        /** Published under the new identity before anything is stored. */
        profileToPublish?: ProfileMetadata;
        /** The custom identity this device keeps attached, stored with the switch. */
        attachNsec?: string;
        identitySource?: NostrIdentitySource;
        invalidMessageKey?: I18nKey;
        persistSyncedIdentity?: boolean;
        recordChatNotice?: boolean;
        restoredAccount?: boolean;
        switchedAtSec?: number | null;
      },
    ) => {
      const invalidMessageKey =
        options?.invalidMessageKey ?? "onboardingInvalidSeed";
      const raw = nsec.trim();
      if (!raw) {
        pushToast(t(invalidMessageKey));
        return;
      }

      const normalizedSlip39 = sourceSlip39Seed.trim();
      if (!normalizedSlip39) {
        pushToast(t(invalidMessageKey));
        return;
      }

      const appMnemonic = await deriveAppMnemonicFromSlip39(normalizedSlip39);
      if (!appMnemonic) {
        pushToast(t(invalidMessageKey));
        return;
      }

      const derivedCashuMnemonic =
        await deriveCashuBip85MnemonicFromSlip39(normalizedSlip39);
      if (!derivedCashuMnemonic) {
        pushToast(t(invalidMessageKey));
        return;
      }

      const identitySource = options?.identitySource ?? "derived";
      const changedAtSec = Math.ceil(Date.now() / 1000);
      const switchedAtSec =
        identitySource === "custom"
          ? (options?.switchedAtSec ?? changedAtSec)
          : null;
      const previousNsec = (currentNsec ?? "").trim();
      const shouldRecordChatNotice =
        options?.recordChatNotice === true &&
        Boolean(previousNsec) &&
        previousNsec !== raw;

      const published = options?.profileToPublish
        ? await publishProfileForNewKey(raw, options.profileToPublish)
        : true;
      if (!published) {
        pushToast(t("nostrKeySwitchProfilePublishFailed"));
        return;
      }

      if (options?.attachNsec)
        await writeStoredAttachedNsec(options.attachNsec);
      await persistIdentitySecrets({
        appMnemonic,
        cashuMnemonic: derivedCashuMnemonic,
        identitySource,
        nsec: raw,
        slip39Seed: normalizedSlip39,
        switchedAtSec,
      });
      if (options?.restoredAccount === true)
        markAwaitingFirstHydration(localStorageKv, appMnemonic);

      if (options?.persistSyncedIdentity !== false) {
        await upsertActiveNostrIdentity(raw, identitySource, switchedAtSec);
      }

      if (shouldRecordChatNotice) {
        await messagesCommands?.appendIdentityChangeNotices({
          changedAtSec,
          identitySource,
        });
      }

      clearLegacyLaneStorage();

      setIsSeedLogin(true);
      setActiveNostrIdentitySource(identitySource);
      setSlip39Seed(normalizedSlip39);
      setCashuSeedMnemonic(derivedCashuMnemonic);

      navigateTo({ route: "contacts" });
      stopBeaconForIdentityChange();
      // The next boot creates the Evolu instance from the app mnemonic saved
      // above. Resetting the currently open instance here is both unnecessary
      // and unsafe: Evolu's restore promise stays pending when its DB reset
      // fails, which would leave onboarding busy forever and skip this reload.
      globalThis.location.reload();
    },
    [
      currentNsec,
      deriveAppMnemonicFromSlip39,
      messagesCommands,
      setActiveNostrIdentitySource,
      publishProfileForNewKey,
      pushToast,
      t,
      upsertActiveNostrIdentity,
      setSlip39Seed,
    ],
  );

  React.useEffect(() => {
    if (!isSeedLogin) return;
    if (activeNostrIdentitySource === "custom") return;

    const normalizedSeed = (slip39Seed ?? "").trim();
    if (!normalizedSeed) return;

    const normalizedCurrentNsec = (currentNsec ?? "").trim();

    let cancelled = false;
    void (async () => {
      const derived = await deriveNostrKeysFromSlip39(normalizedSeed);
      if (!derived || cancelled) return;

      const normalizedDerivedNsec = derived.nsec.trim();
      if (!normalizedDerivedNsec) return;
      if (normalizedDerivedNsec === normalizedCurrentNsec) return;

      await setIdentityFromNsecAndReload(
        normalizedDerivedNsec,
        normalizedSeed,
        {
          identitySource: "derived",
          invalidMessageKey: "restoreFailed",
          switchedAtSec: null,
        },
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activeNostrIdentitySource,
    currentNsec,
    isSeedLogin,
    setIdentityFromNsecAndReload,
    slip39Seed,
  ]);

  const createNewAccount = React.useCallback(async () => {
    if (onboardingIsBusy) return;

    setOnboardingIsBusy(true);
    setOnboardingStep({
      kind: "preparing",
      step: 1,
      derivedName: null,
      error: null,
    });
    try {
      const slip39 = await createSlip39Seed();
      if (!slip39) {
        pushToast(t("onboardingCreateFailed"));
        setOnboardingStep({
          kind: "preparing",
          step: 1,
          derivedName: null,
          error: t("onboardingCreateFailed"),
        });
        return;
      }

      const derived = await deriveNostrKeysFromSlip39(slip39);
      if (!derived) {
        pushToast(t("onboardingCreateFailed"));
        setOnboardingStep({
          kind: "preparing",
          step: 1,
          derivedName: null,
          error: t("onboardingCreateFailed"),
        });
        return;
      }

      const npub = derived.npub;
      const normalizedNsec = derived.nsec.trim();
      if (!normalizedNsec) {
        pushToast(t("onboardingCreateFailed"));
        setOnboardingStep({
          kind: "preparing",
          step: 1,
          derivedName: null,
          error: t("onboardingCreateFailed"),
        });
        return;
      }

      const defaults = deriveDefaultProfile(npub, lang);
      setOnboardingStep({
        kind: "preparing",
        step: 1,
        derivedName: defaults.name,
        error: null,
      });

      setOnboardingStep({
        kind: "preparing",
        step: 2,
        derivedName: defaults.name,
        error: null,
      });

      setOnboardingStep({
        kind: "profile",
        error: null,
        name: defaults.name,
        npub,
        nsec: normalizedNsec,
        pictureUrl: defaults.pictureUrl,
        selectedPictureKind: "generated",
        slip39Seed: slip39,
      });
    } finally {
      setOnboardingIsBusy(false);
    }
  }, [lang, onboardingIsBusy, pushToast, t]);

  const setPendingOnboardingName = React.useCallback(
    (value: string) => {
      updatePendingOnboardingProfile((current) => ({
        ...current,
        error: null,
        name: value,
      }));
    },
    [updatePendingOnboardingProfile],
  );

  const shufflePendingOnboardingAvatar = React.useCallback(() => {
    const pictureUrl = buildLoreleiAvatarUrl(crypto.randomUUID());
    updatePendingOnboardingProfile((current) => ({
      ...current,
      error: null,
      pictureUrl,
      selectedPictureKind: "generated",
    }));
  }, [updatePendingOnboardingProfile]);

  const pickPendingOnboardingPhoto = React.useCallback(async () => {
    onboardingPhotoInputRef.current?.pick();
  }, []);

  const onPendingOnboardingPhotoSelected = React.useCallback(
    (pictureUrl: string) => {
      updatePendingOnboardingProfile((current) => ({
        ...current,
        error: null,
        pictureUrl,
        selectedPictureKind: "custom",
      }));
    },
    [updatePendingOnboardingProfile],
  );

  const onPendingOnboardingPhotoError = React.useCallback(
    (error: unknown) => {
      const message = `${t("errorPrefix")}: ${String(error ?? "unknown")}`;
      updatePendingOnboardingProfile((current) => ({
        ...current,
        error: message,
      }));
    },
    [t, updatePendingOnboardingProfile],
  );

  const confirmPendingOnboardingProfile = React.useCallback(async () => {
    if (onboardingIsBusy) return;
    if (!onboardingStep || onboardingStep.kind !== "profile") return;

    const trimmedName = onboardingStep.name.trim();
    const trimmedPicture = onboardingStep.pictureUrl.trim();

    if (!trimmedName) {
      updatePendingOnboardingProfile((current) => ({
        ...current,
        error: t("onboardingNameRequired"),
      }));
      return;
    }

    if (!trimmedPicture) {
      updatePendingOnboardingProfile((current) => ({
        ...current,
        error: t("onboardingAvatarRequired"),
      }));
      return;
    }

    setOnboardingIsBusy(true);
    updatePendingOnboardingProfile((current) => ({
      ...current,
      error: null,
    }));

    try {
      const lnAddress = deriveDefaultProfile(onboardingStep.npub).lnAddress;

      try {
        await publishNewProfileMetadata({
          lnAddress,
          name: trimmedName,
          npub: onboardingStep.npub,
          nsec: onboardingStep.nsec,
          pictureUrl: trimmedPicture,
        });
      } catch (error) {
        const message = `${t("errorPrefix")}: ${String(error ?? "unknown")}`;
        updatePendingOnboardingProfile((current) => ({
          ...current,
          error: message,
        }));
        pushToast(message);
        return;
      }

      safeLocalStorageSet(CASHU_ONBOARDING_SET_MAIN_MINT_STORAGE_KEY, "1");

      await setIdentityFromNsecAndReload(
        onboardingStep.nsec,
        onboardingStep.slip39Seed,
        {
          identitySource: "derived",
          invalidMessageKey: "onboardingCreateFailed",
          switchedAtSec: null,
        },
      );
    } finally {
      setOnboardingIsBusy(false);
    }
  }, [
    onboardingIsBusy,
    onboardingStep,
    publishNewProfileMetadata,
    pushToast,
    setIdentityFromNsecAndReload,
    t,
    updatePendingOnboardingProfile,
  ]);

  const savePendingOnboardingBackupToPasswordManager =
    React.useCallback(async () => {
      if (onboardingIsBusy) return;
      if (!onboardingStep || onboardingStep.kind !== "profile") return;

      setOnboardingIsBusy(true);
      try {
        await triggerPasswordManagerSeedSave({
          displayName: onboardingStep.name,
          password: onboardingStep.slip39Seed,
        });
      } finally {
        setOnboardingIsBusy(false);
      }
    }, [onboardingIsBusy, onboardingStep]);

  const openReturningOnboarding = React.useCallback(() => {
    if (onboardingIsBusy) return;

    setOnboardingStep({
      kind: "returning",
      error: null,
      words: emptySlip39Words(),
    });
  }, [onboardingIsBusy]);

  const setReturningSlip39Words = React.useCallback(
    (words: readonly string[]) => {
      updateReturningOnboardingStep((current) => ({
        ...current,
        error: null,
        words,
      }));
    },
    [updateReturningOnboardingStep],
  );

  const submitReturningSlip39 = React.useCallback(
    async (inputOverride?: string) => {
      if (onboardingIsBusy) return;

      const rawInput =
        typeof inputOverride === "string"
          ? inputOverride
          : onboardingStep?.kind === "returning"
            ? slip39WordsToInput(onboardingStep.words)
            : "";
      const normalizedSlip39 = normalizeSlip39Input(rawInput);
      const fail = (message: string) => {
        updateReturningOnboardingStep((current) => ({
          ...current,
          error: message,
        }));
        pushToast(message);
      };

      updateReturningOnboardingStep((current) => ({ ...current, error: null }));

      if (!normalizedSlip39) {
        fail(t("pasteEmpty"));
        return;
      }

      if (!looksLikeSlip39Share(normalizedSlip39)) {
        fail(t("onboardingInvalidSeed"));
        return;
      }

      setOnboardingIsBusy(true);
      try {
        const derived = await deriveNostrKeysFromSlip39(normalizedSlip39);
        if (!derived) {
          fail(t("onboardingInvalidSeed"));
          return;
        }

        await setIdentityFromNsecAndReload(derived.nsec, normalizedSlip39, {
          identitySource: "derived",
          invalidMessageKey: "onboardingInvalidSeed",
          // Do not overwrite a custom identity that may still be syncing to
          // this newly restored device.
          persistSyncedIdentity: false,
          restoredAccount: true,
          switchedAtSec: null,
        });
      } finally {
        setOnboardingIsBusy(false);
      }
    },
    [
      onboardingIsBusy,
      onboardingStep,
      pushToast,
      setIdentityFromNsecAndReload,
      t,
      updateReturningOnboardingStep,
    ],
  );

  /**
   * Writes pasted text into the grid from `fromIndex` and submits once every
   * slot holds a word; answers with the slot to focus otherwise.
   */
  const pasteReturningSlip39 = React.useCallback(
    (text: string, fromIndex: number): number => {
      const words =
        onboardingStep?.kind === "returning"
          ? onboardingStep.words
          : emptySlip39Words();
      const fill = fillSlip39Words(words, fromIndex, text);
      const error =
        fill.overflow > 0 ? t("onboardingReturnTooManyWords") : null;
      updateReturningOnboardingStep((current) => ({
        ...current,
        error,
        words: fill.words,
      }));
      if (!error && analyzeSlip39Words(fill.words, null).isComplete) {
        void submitReturningSlip39(slip39WordsToInput(fill.words));
      }
      return fill.nextIndex;
    },
    [onboardingStep, submitReturningSlip39, t, updateReturningOnboardingStep],
  );

  const pasteReturningSlip39FromClipboard = React.useCallback(async () => {
    if (onboardingIsBusy) return;

    try {
      const text = await readClipboardText();
      if (text === null) {
        pushToast(t("pasteNotAvailable"));
        return;
      }

      const raw = text.trim();
      if (!raw) {
        pushToast(t("pasteEmpty"));
        return;
      }

      pasteReturningSlip39(raw, 0);
    } catch {
      pushToast(t("pasteNotAvailable"));
    }
  }, [onboardingIsBusy, pasteReturningSlip39, pushToast, t]);

  const switchIdentity = React.useCallback(
    async (
      nsec: string,
      target: IdentitySwitchTarget,
      profileToPublish: ProfileMetadata,
    ) => {
      // The custom identity stays attached to this device, so the user can
      // come back to it after switching to the derived one.
      const customNsec =
        target === "custom"
          ? nsec
          : activeNostrIdentitySource === "custom"
            ? (currentNsec ?? "").trim()
            : "";
      await setIdentityFromNsecAndReload(nsec, (slip39Seed ?? "").trim(), {
        ...(customNsec ? { attachNsec: customNsec } : {}),
        identitySource: target === "custom" ? "custom" : "derived",
        invalidMessageKey: "nostrPasteInvalid",
        profileToPublish,
        recordChatNotice: true,
        switchedAtSec:
          target === "custom" ? Math.ceil(Date.now() / 1000) : null,
      });
    },
    [
      activeNostrIdentitySource,
      currentNsec,
      setIdentityFromNsecAndReload,
      slip39Seed,
    ],
  );

  /**
   * Checks the identity's profile, then switches. A freshly pasted identity
   * waits for the user to choose its profile; an identity the user already
   * had keeps the profile it has, so the switch asks nothing more unless the
   * profile could not be fetched.
   */
  const startIdentitySwitch = React.useCallback(
    async (
      nsec: string,
      target: IdentitySwitchTarget,
      { chooseProfile }: { chooseProfile: boolean },
    ) => {
      const secretKey = await decodeNsecPrivateBytes(nsec);
      if (!secretKey) {
        pushToast(t("nostrPasteInvalid"));
        return;
      }
      if (nsec === (currentNsec ?? "").trim()) return;

      const pubkey = derivePubkey(secretKey);
      const npub = encodeNpub(pubkey);
      const linkyProfile =
        myProfileMetadata ??
        (currentNpub ? loadCachedProfile(currentNpub)?.metadata : null) ??
        new ProfileMetadata({});
      // Cancelling settles the race at once, so the caller's busy flag is released without waiting for relays.
      const cancelled = new Promise<null>((resolve) => {
        cancelIdentityCheckRef.current = () => resolve(null);
      });
      setPendingIdentitySwitch({ phase: "checking", npub, pubkey, target });
      const checked = await Promise.race([
        checkIdentityForSwitch({
          fetchProfile,
          lookupOwnedAddress: () => fetchOwnedLightningAddress(secretKey),
          npub,
          pubkey,
          target,
        }),
        cancelled,
      ]);
      cancelIdentityCheckRef.current = null;
      if (!checked) return;
      const { check, lightningAddress } = checked;
      // An unchecked identity may have a profile of its own, so the user picks one even when switching back.
      if (check.kind === "none" || (check.kind === "found" && !chooseProfile)) {
        setPendingIdentitySwitch({ phase: "switching", npub, pubkey, target });
        try {
          await switchIdentity(
            nsec,
            target,
            profileForIdentitySwitch({
              lightningAddress,
              linkyProfile,
              nostrProfile: check.kind === "found" ? check.metadata : null,
              source: check.kind === "found" ? "nostr" : "linky",
            }),
          );
        } finally {
          setPendingIdentitySwitch(null);
        }
        return;
      }
      setPendingIdentitySwitch({
        phase: "choosing",
        check,
        lightningAddress,
        linkyProfile,
        npub,
        nsec,
        pubkey,
        target,
      });
    },
    [
      currentNpub,
      currentNsec,
      decodeNsecPrivateBytes,
      fetchProfile,
      myProfileMetadata,
      pushToast,
      switchIdentity,
      t,
      setPendingIdentitySwitch,
    ],
  );

  const requestPasteNostrKeys = React.useCallback(async () => {
    if (onboardingIsBusy) return;

    const normalizedSeed = (slip39Seed ?? "").trim();
    if (!normalizedSeed) {
      pushToast(t("seedMissing"));
      return;
    }

    setOnboardingIsBusy(true);
    try {
      const text = await readClipboardText();
      if (text === null) {
        pushToast(t("pasteNotAvailable"));
        return;
      }

      const raw = text.trim();
      if (!raw) {
        pushToast(t("pasteEmpty"));
        return;
      }

      await startIdentitySwitch(raw, "custom", { chooseProfile: true });
    } finally {
      setOnboardingIsBusy(false);
    }
  }, [onboardingIsBusy, pushToast, slip39Seed, startIdentitySwitch, t]);

  const switchToDefaultIdentity = React.useCallback(async () => {
    if (onboardingIsBusy || !defaultNsec) return;

    setOnboardingIsBusy(true);
    try {
      await startIdentitySwitch(defaultNsec, "default", {
        chooseProfile: false,
      });
    } finally {
      setOnboardingIsBusy(false);
    }
  }, [defaultNsec, onboardingIsBusy, startIdentitySwitch]);

  const switchToAttachedIdentity = React.useCallback(async () => {
    if (onboardingIsBusy || !attachedNsec) return;

    setOnboardingIsBusy(true);
    try {
      await startIdentitySwitch(attachedNsec, "custom", {
        chooseProfile: false,
      });
    } finally {
      setOnboardingIsBusy(false);
    }
  }, [attachedNsec, onboardingIsBusy, startIdentitySwitch]);

  const removeAttachedIdentity = React.useCallback(async () => {
    if (!attachedNsec || attachedNsec === (currentNsec ?? "").trim()) return;
    await removeStoredAttachedNsec();
    setAttachedNsec(null);
    reportAppLog({
      tag: "identitySwitch.attachedRemoved",
      summary: "User removed the attached custom identity from this device",
      payload: { npub: attachedNpub },
    });
  }, [attachedNpub, attachedNsec, currentNsec, setAttachedNsec]);

  React.useEffect(() => {
    if (!attachedNsec) {
      setAttachedNpub(null);
      return;
    }
    let cancelled = false;
    void deriveNpubFromNsec(attachedNsec).then((npub) => {
      if (!cancelled) setAttachedNpub(npub);
    });
    return () => {
      cancelled = true;
    };
  }, [attachedNsec, deriveNpubFromNsec, setAttachedNpub]);

  const answerPendingIdentitySwitch = React.useCallback(
    async (source: IdentityProfileSource | null) => {
      if (pendingIdentitySwitch?.phase === "checking" && source === null) {
        cancelIdentityCheckRef.current?.();
        setPendingIdentitySwitch(null);
        reportAppLog({
          tag: "identitySwitch.profileChosen",
          summary: "User cancelled the identity switch during its check",
          links: { pubkey: pendingIdentitySwitch.pubkey },
          payload: {
            check: "checking",
            choice: "cancel",
            target: pendingIdentitySwitch.target,
          },
        });
        return;
      }
      if (pendingIdentitySwitch?.phase !== "choosing" || onboardingIsBusy) {
        return;
      }
      const { check, lightningAddress, linkyProfile, nsec, pubkey, target } =
        pendingIdentitySwitch;
      reportAppLog({
        tag: "identitySwitch.profileChosen",
        summary:
          source === null
            ? "User cancelled the identity switch"
            : `User switched identity using the ${source} profile`,
        links: { pubkey },
        payload: { check: check.kind, choice: source ?? "cancel", target },
      });
      if (source === null) {
        setPendingIdentitySwitch(null);
        return;
      }

      setOnboardingIsBusy(true);
      try {
        await switchIdentity(
          nsec,
          target,
          profileForIdentitySwitch({
            lightningAddress,
            linkyProfile,
            nostrProfile: check.kind === "found" ? check.metadata : null,
            source,
          }),
        );
      } finally {
        setPendingIdentitySwitch(null);
        setOnboardingIsBusy(false);
      }
    },
    [
      onboardingIsBusy,
      pendingIdentitySwitch,
      switchIdentity,
      setPendingIdentitySwitch,
    ],
  );

  const requestLogout = React.useCallback(
    ({ evoluConnected }: { evoluConnected: boolean }) => {
      if (!logoutArmed) {
        setLogoutArmed(true);
        pushToast(
          t(evoluConnected ? "logoutArmedHint" : "logoutUnsyncedArmedHint"),
        );
        return;
      }

      void (async () => {
        setLogoutArmed(false);
        reportAppLog({
          tag: "auth.loggedOut",
          summary:
            "User logged out; every tab reloads to erase this device's data",
          payload: { evoluConnected },
        });
        stopBeaconForIdentityChange();
        // Native secret storage lives outside the site data the wipe deletes.
        await clearIdentitySecrets();
        markLogoutPending();
        globalThis.location.reload();
      })();
    },
    [logoutArmed, pushToast, t, setLogoutArmed],
  );

  React.useEffect(() => {
    if (!logoutArmed) return;

    const timeoutId = window.setTimeout(() => {
      setLogoutArmed(false);
    }, 5000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [logoutArmed, setLogoutArmed]);

  return {
    answerPendingIdentitySwitch,
    attachedIdentityNpub: attachedNpub,
    canSwitchToDefaultIdentity:
      defaultNsec !== null && defaultNsec !== (currentNsec ?? "").trim(),
    confirmPendingOnboardingProfile,
    createNewAccount,
    currentNpub,
    derivedIdentityNpub: defaultNpub,
    isSeedLogin,
    logoutArmed,
    nostrIdentitySource: activeNostrIdentitySource,
    onboardingIsBusy,
    onboardingPhotoInputRef,
    onboardingStep,
    openReturningOnboarding,
    onPendingOnboardingPhotoSelected,
    onPendingOnboardingPhotoError,
    pasteReturningSlip39,
    pasteReturningSlip39FromClipboard,
    pendingIdentitySwitch,
    pickPendingOnboardingPhoto,
    removeAttachedIdentity,
    requestPasteNostrKeys,
    requestLogout,
    savePendingOnboardingBackupToPasswordManager,
    shufflePendingOnboardingAvatar,
    cashuSeedMnemonic,
    seedMnemonic,
    slip39Seed,
    setReturningSlip39Words,
    setOnboardingStep,
    setPendingOnboardingName,
    submitReturningSlip39,
    switchToAttachedIdentity,
    switchToDefaultIdentity,
  };
};
