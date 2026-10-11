import { useAtomSet, useAtomValue } from "@linky-fit/linkstr-react";
import React from "react";
import {
  triggerPasswordManagerSeedSave,
  type PasswordManagerSaveResult,
} from "../../../platform/passwordManager";
import { writeBrowserClipboardText } from "../../../platform/clipboard";
import type { IdentityProfileSource } from "../../lib/keySwitchProfile";
import { contactsOnboardingHasBackedUpKeysAtom } from "../../state/contacts/onboarding";
import {
  canSwitchToDefaultIdentityAtom,
  identityCommandsAtom,
  logoutArmedAtom,
  pendingIdentitySwitchAtom,
  seedMnemonicAtom,
  slip39SeedAtom,
} from "../../state/session/identity";
import { currentNpubAtom, currentNsecAtom } from "../../state/session/session";
import { useEffectiveProfile } from "../profile/useEffectiveProfile";
import { usePushToast, useTranslation } from "../shell";

export const useSeedMnemonic = () => useAtomValue(seedMnemonicAtom);

/** Identity switches and logout as Settings offers them. */
export const useIdentitySettings = () => {
  const commands = useAtomValue(identityCommandsAtom);
  const answerPendingIdentitySwitch = React.useCallback(
    async (source: IdentityProfileSource | null) =>
      commands?.read().answerPendingIdentitySwitch(source),
    [commands],
  );
  const requestLogout = React.useCallback(
    (options: { evoluConnected: boolean }) =>
      commands?.read().requestLogout(options),
    [commands],
  );
  const requestPasteNostrKeys = React.useCallback(
    async () => commands?.read().requestPasteNostrKeys(),
    [commands],
  );
  const switchToDefaultIdentity = React.useCallback(
    async () => commands?.read().switchToDefaultIdentity(),
    [commands],
  );
  return {
    answerPendingIdentitySwitch,
    canSwitchToDefaultIdentity: useAtomValue(canSwitchToDefaultIdentityAtom),
    logoutArmed: useAtomValue(logoutArmedAtom),
    pendingIdentitySwitch: useAtomValue(pendingIdentitySwitchAtom),
    requestLogout,
    requestPasteNostrKeys,
    seedMnemonic: useSeedMnemonic(),
    switchToDefaultIdentity,
  };
};

export const useCopyNostrKeys = () => {
  const currentNsec = useAtomValue(currentNsecAtom);
  const pushToast = usePushToast();
  const { t } = useTranslation();
  return React.useCallback(async () => {
    const nsec = (currentNsec ?? "").trim();
    if (!nsec) return;
    await writeBrowserClipboardText(nsec);
    pushToast(t("nostrKeysCopied"));
  }, [currentNsec, pushToast, t]);
};

/** Copying the recovery seed, or handing it to the password manager. */
export const useSeedBackup = () => {
  const slip39Seed = useAtomValue(slip39SeedAtom);
  const setBackedUp = useAtomSet(contactsOnboardingHasBackedUpKeysAtom);
  const currentNpub = useAtomValue(currentNpubAtom);
  const { effectiveProfileName } = useEffectiveProfile();
  const pushToast = usePushToast();
  const { t } = useTranslation();

  const copySeed = React.useCallback(async () => {
    const value = (slip39Seed ?? "").trim();
    if (!value) {
      pushToast(t("seedMissing"));
      return;
    }
    await writeBrowserClipboardText(value);
    setBackedUp(true);
    pushToast(t("seedCopied"));
  }, [pushToast, setBackedUp, slip39Seed, t]);

  const saveSeedToPasswordManager =
    React.useCallback(async (): Promise<PasswordManagerSaveResult> => {
      const password = (slip39Seed ?? "").trim();
      if (!password) return "failed";
      return triggerPasswordManagerSeedSave({
        displayName: effectiveProfileName ?? currentNpub ?? "",
        password,
      });
    }, [currentNpub, effectiveProfileName, slip39Seed]);

  return { copySeed, saveSeedToPasswordManager };
};
