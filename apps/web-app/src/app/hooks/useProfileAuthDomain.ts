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
  type Pubkey,
} from "@linky-fit/linkstr";
import {
  fetchProfileAtom,
  linkstrConfigAtom,
  publishProfileAtom,
  publishStatusAtom,
  useAtomSet,
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
  readStoredCashuMnemonic,
  readStoredSlip39Seed,
  writeStoredCashuMnemonic,
} from "../../platform/identitySecrets";
import { reportAppLog } from "../../devtools/inspector/appLog";
import { markAwaitingFirstHydration } from "../../firstHydration";
import { markLogoutPending } from "../../platform/logoutWipe";
import { triggerPasswordManagerSeedSave } from "../../platform/passwordManager";
import { CASHU_ONBOARDING_SET_MAIN_MINT_STORAGE_KEY } from "../../utils/constants";
import { getDefaultNip05IdentifierFromAddress } from "../../utils/nostrNip05";
import {
  applySlip39Suggestion,
  normalizeSlip39Input,
} from "../../utils/slip39Input";
import {
  createSlip39Seed,
  deriveCashuBip85MnemonicFromSlip39,
  deriveEvoluOwnerMnemonicFromSlip39,
  deriveNostrKeysFromSlip39,
} from "../../utils/slip39Nostr";
import { looksLikeSlip39Share } from "@linky-fit/identity";
import type { IdentityChangeMessageSource } from "../lib/identityChangeMessage";
import { buildLinkstrConfig } from "./useLinkstrConfigSync";
import { clearLegacyLaneStorage } from "../migrations/laneToShardMigration";
import { runWrite } from "../lib/storeWrite";
import {
  getInitialNostrIdentitySource,
  safeLocalStorageSet,
} from "../../utils/storage";
import type { FilePickerHandle } from "../../utils/pickFile";
import { nowSeconds } from "../../utils/time";
import { prepareProfilePicture } from "../lib/profilePicture";
import {
  checkIdentityForSwitch,
  profileForIdentitySwitch,
  type IdentityProfileCheck,
  type IdentityProfileSource,
  type IdentitySwitchTarget,
} from "../lib/keySwitchProfile";
import { fetchOwnedLightningAddress } from "../../utils/npubCashInfo";
import type { I18nKey, Translate } from "../../i18n";

type NostrIdentitySource = "custom" | "derived";

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
export type PendingIdentitySwitch =
  | {
      phase: "checking" | "switching";
      npub: string;
      pubkey: Pubkey;
      target: IdentitySwitchTarget;
    }
  | {
      phase: "choosing";
      check: Exclude<IdentityProfileCheck, { kind: "none" }>;
      lightningAddress: string;
      linkyProfile: ProfileMetadata;
      npub: string;
      nsec: string;
      pubkey: Pubkey;
      target: IdentitySwitchTarget;
    };

export interface ReturningOnboardingStep {
  error: string | null;
  input: string;
  kind: "returning";
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
  appendIdentityChangeNoticesRef: React.MutableRefObject<
    | ((args: {
        changedAtSec: number;
        identitySource: IdentityChangeMessageSource;
      }) => void)
    | null
  >;
  currentNsec: string | null;
  /** Null outside an authenticated session; the identity mirror is then not written. */
  identityRepository: IdentityRepository | null;
  /** Null outside an authenticated session, like `identityRepository`. */
  inboxCursors: InboxCursorsRepository | null;
  lang: Lang;
  myProfileMetadataRef: React.MutableRefObject<ProfileMetadata | null>;
  pushToast: (message: string) => void;
  t: Translate;
}

interface UseProfileAuthDomainResult {
  answerPendingIdentitySwitch: (
    source: IdentityProfileSource | null,
  ) => Promise<void>;
  /** Whether a custom identity is active, so the seed's own identity can be switched back to. */
  canSwitchToDefaultIdentity: boolean;
  pendingIdentitySwitch: PendingIdentitySwitch | null;
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
  pasteReturningSlip39FromClipboard: () => Promise<void>;
  pickPendingOnboardingPhoto: () => Promise<void>;
  requestPasteNostrKeys: () => Promise<void>;
  requestLogout: (options: { evoluConnected: boolean }) => void;
  savePendingOnboardingBackupToPasswordManager: () => Promise<void>;
  seedMnemonic: string | null;
  shufflePendingOnboardingAvatar: () => void;
  selectReturningSlip39Suggestion: (value: string) => void;
  cashuSeedMnemonic: string | null;
  slip39Seed: string | null;
  setReturningSlip39Input: (value: string) => void;
  setOnboardingStep: React.Dispatch<React.SetStateAction<OnboardingStep>>;
  setPendingOnboardingName: (value: string) => void;
  submitReturningSlip39: (inputOverride?: string) => Promise<void>;
}

export const useProfileAuthDomain = ({
  appendIdentityChangeNoticesRef,
  currentNsec,
  identityRepository,
  inboxCursors,
  lang,
  myProfileMetadataRef,
  pushToast,
  t,
}: UseProfileAuthDomainParams): UseProfileAuthDomainResult => {
  const [currentNpub, setCurrentNpub] = React.useState<string | null>(null);
  const [onboardingIsBusy, setOnboardingIsBusy] = React.useState(false);
  const [onboardingStep, setOnboardingStep] =
    React.useState<OnboardingStep>(null);
  const [seedMnemonic, setSeedMnemonic] = React.useState<string | null>(null);
  const [cashuSeedMnemonic, setCashuSeedMnemonic] = React.useState<
    string | null
  >(null);
  const [slip39Seed, setSlip39Seed] = React.useState<string | null>(null);
  const [activeNostrIdentitySource, setActiveNostrIdentitySource] =
    React.useState<NostrIdentitySource>(() => getInitialNostrIdentitySource());
  const [logoutArmed, setLogoutArmed] = React.useState(false);
  const [pendingIdentitySwitch, setPendingIdentitySwitch] =
    React.useState<PendingIdentitySwitch | null>(null);
  const [defaultNsec, setDefaultNsec] = React.useState<string | null>(null);
  // Cancelling clears it, so a check that resolves afterwards changes nothing.
  const identityCheckRef = React.useRef<object | null>(null);
  const onboardingPhotoInputRef = React.useRef<FilePickerHandle | null>(null);
  const [isSeedLogin, setIsSeedLogin] = React.useState(false);
  const setLinkstrConfig = useAtomSet(linkstrConfigAtom);
  const publishProfile = useAtomSet(publishProfileAtom, {
    mode: "promiseExit",
  });
  const publishStatus = useAtomSet(publishStatusAtom, {
    mode: "promiseExit",
  });
  const fetchProfile = useAtomSet(fetchProfileAtom, { mode: "promiseExit" });

  React.useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [storedCashuMnemonic, storedSlip39Seed] = await Promise.all([
        readStoredCashuMnemonic(),
        readStoredSlip39Seed(),
      ]);

      if (cancelled) return;
      setCashuSeedMnemonic(storedCashuMnemonic);
      setSlip39Seed(storedSlip39Seed);
      setIsSeedLogin(Boolean(storedSlip39Seed));
    })();

    return () => {
      cancelled = true;
    };
  }, []);
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

  React.useEffect(() => {
    const nsec = (currentNsec ?? "").trim();
    if (!nsec) {
      setCurrentNpub(null);
      return;
    }

    let cancelled = false;
    const run = async () => {
      const privBytes = await decodeNsecPrivateBytes(nsec);
      if (!privBytes) return;
      const npub = encodeNpub(derivePubkey(privBytes));

      if (cancelled) return;
      setCurrentNpub(npub);
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [currentNsec, decodeNsecPrivateBytes]);

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
    const normalizedSlip39 = (slip39Seed ?? "").trim();
    setSeedMnemonic(normalizedSlip39 || null);
  }, [slip39Seed]);

  React.useEffect(() => {
    const normalizedSeed = (slip39Seed ?? "").trim();
    if (!normalizedSeed) {
      setDefaultNsec(null);
      return;
    }

    let cancelled = false;
    void deriveNostrKeysFromSlip39(normalizedSeed).then((derived) => {
      if (!cancelled) setDefaultNsec(derived?.nsec.trim() || null);
    });
    return () => {
      cancelled = true;
    };
  }, [slip39Seed]);

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

      await persistIdentitySecrets({
        appMnemonic,
        cashuMnemonic: derivedCashuMnemonic,
        identitySource,
        nsec: raw,
        slip39Seed: normalizedSlip39,
        switchedAtSec,
      });
      if (options?.restoredAccount === true)
        markAwaitingFirstHydration(appMnemonic);

      if (options?.persistSyncedIdentity !== false) {
        await upsertActiveNostrIdentity(raw, identitySource, switchedAtSec);
      }

      if (shouldRecordChatNotice) {
        appendIdentityChangeNoticesRef.current?.({
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
      // The next boot creates the Evolu instance from the app mnemonic saved
      // above. Resetting the currently open instance here is both unnecessary
      // and unsafe: Evolu's restore promise stays pending when its DB reset
      // fails, which would leave onboarding busy forever and skip this reload.
      globalThis.location.reload();
    },
    [
      appendIdentityChangeNoticesRef,
      currentNsec,
      deriveAppMnemonicFromSlip39,
      publishProfileForNewKey,
      pushToast,
      t,
      upsertActiveNostrIdentity,
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
      input: "",
    });
  }, [onboardingIsBusy]);

  const setReturningSlip39Input = React.useCallback(
    (value: string) => {
      updateReturningOnboardingStep((current) => ({
        ...current,
        error: null,
        input: value,
      }));
    },
    [updateReturningOnboardingStep],
  );

  const selectReturningSlip39Suggestion = React.useCallback(
    (value: string) => {
      updateReturningOnboardingStep((current) => ({
        ...current,
        error: null,
        input: applySlip39Suggestion(current.input, value),
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
            ? onboardingStep.input
            : "";
      const normalizedSlip39 = normalizeSlip39Input(rawInput);

      updateReturningOnboardingStep((current) => ({
        ...current,
        error: null,
        input: normalizedSlip39,
      }));

      if (!normalizedSlip39) {
        const message = t("pasteEmpty");
        updateReturningOnboardingStep((current) => ({
          ...current,
          error: message,
          input: normalizedSlip39,
        }));
        pushToast(message);
        return;
      }

      if (!looksLikeSlip39Share(normalizedSlip39)) {
        const message = t("onboardingInvalidSeed");
        updateReturningOnboardingStep((current) => ({
          ...current,
          error: message,
          input: normalizedSlip39,
        }));
        pushToast(message);
        return;
      }

      setOnboardingIsBusy(true);
      try {
        const derived = await deriveNostrKeysFromSlip39(normalizedSlip39);
        if (!derived) {
          const message = t("onboardingInvalidSeed");
          updateReturningOnboardingStep((current) => ({
            ...current,
            error: message,
            input: normalizedSlip39,
          }));
          pushToast(message);
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

      updateReturningOnboardingStep((current) => ({
        ...current,
        error: null,
        input: raw,
      }));
      await submitReturningSlip39(raw);
    } catch {
      pushToast(t("pasteNotAvailable"));
    }
  }, [
    onboardingIsBusy,
    pushToast,
    submitReturningSlip39,
    t,
    updateReturningOnboardingStep,
  ]);

  const switchIdentity = React.useCallback(
    async (
      nsec: string,
      target: IdentitySwitchTarget,
      profileToPublish: ProfileMetadata,
    ) => {
      await setIdentityFromNsecAndReload(nsec, (slip39Seed ?? "").trim(), {
        identitySource: target === "custom" ? "custom" : "derived",
        invalidMessageKey: "nostrPasteInvalid",
        profileToPublish,
        recordChatNotice: true,
        switchedAtSec:
          target === "custom" ? Math.ceil(Date.now() / 1000) : null,
      });
    },
    [setIdentityFromNsecAndReload, slip39Seed],
  );

  /** Checks the identity's profile, then switches or waits for the user's choice. */
  const startIdentitySwitch = React.useCallback(
    async (nsec: string, target: IdentitySwitchTarget) => {
      const secretKey = await decodeNsecPrivateBytes(nsec);
      if (!secretKey) {
        pushToast(t("nostrPasteInvalid"));
        return;
      }
      if (nsec === (currentNsec ?? "").trim()) return;

      const pubkey = derivePubkey(secretKey);
      const npub = encodeNpub(pubkey);
      const linkyProfile =
        myProfileMetadataRef.current ??
        (currentNpub ? loadCachedProfile(currentNpub)?.metadata : null) ??
        new ProfileMetadata({});
      const checkToken = {};
      identityCheckRef.current = checkToken;
      setPendingIdentitySwitch({ phase: "checking", npub, pubkey, target });
      const { check, lightningAddress } = await checkIdentityForSwitch({
        fetchProfile,
        lookupOwnedAddress: () => fetchOwnedLightningAddress(secretKey),
        npub,
        pubkey,
        target,
      });
      if (identityCheckRef.current !== checkToken) return;
      identityCheckRef.current = null;
      if (check.kind === "none") {
        setPendingIdentitySwitch({ phase: "switching", npub, pubkey, target });
        try {
          await switchIdentity(
            nsec,
            target,
            profileForIdentitySwitch({
              lightningAddress,
              linkyProfile,
              nostrProfile: null,
              source: "linky",
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
      myProfileMetadataRef,
      pushToast,
      switchIdentity,
      t,
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

      await startIdentitySwitch(raw, "custom");
    } finally {
      setOnboardingIsBusy(false);
    }
  }, [onboardingIsBusy, pushToast, slip39Seed, startIdentitySwitch, t]);

  const switchToDefaultIdentity = React.useCallback(async () => {
    if (onboardingIsBusy || !defaultNsec) return;

    setOnboardingIsBusy(true);
    try {
      await startIdentitySwitch(defaultNsec, "default");
    } finally {
      setOnboardingIsBusy(false);
    }
  }, [defaultNsec, onboardingIsBusy, startIdentitySwitch]);

  const answerPendingIdentitySwitch = React.useCallback(
    async (source: IdentityProfileSource | null) => {
      if (pendingIdentitySwitch?.phase === "checking" && source === null) {
        identityCheckRef.current = null;
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
    [onboardingIsBusy, pendingIdentitySwitch, switchIdentity],
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
        // Native secret storage lives outside the site data the wipe deletes.
        await clearIdentitySecrets();
        markLogoutPending();
        globalThis.location.reload();
      })();
    },
    [logoutArmed, pushToast, t],
  );

  React.useEffect(() => {
    if (!logoutArmed) return;

    const timeoutId = window.setTimeout(() => {
      setLogoutArmed(false);
    }, 5000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [logoutArmed]);

  return {
    answerPendingIdentitySwitch,
    canSwitchToDefaultIdentity:
      defaultNsec !== null && defaultNsec !== (currentNsec ?? "").trim(),
    confirmPendingOnboardingProfile,
    createNewAccount,
    currentNpub,
    isSeedLogin,
    logoutArmed,
    onboardingIsBusy,
    onboardingPhotoInputRef,
    onboardingStep,
    openReturningOnboarding,
    onPendingOnboardingPhotoSelected,
    onPendingOnboardingPhotoError,
    pasteReturningSlip39FromClipboard,
    pendingIdentitySwitch,
    pickPendingOnboardingPhoto,
    requestPasteNostrKeys,
    requestLogout,
    savePendingOnboardingBackupToPasswordManager,
    shufflePendingOnboardingAvatar,
    selectReturningSlip39Suggestion,
    cashuSeedMnemonic,
    seedMnemonic,
    slip39Seed,
    setReturningSlip39Input,
    setOnboardingStep,
    setPendingOnboardingName,
    submitReturningSlip39,
    switchToDefaultIdentity,
  };
};
