import { StatusDraft } from "@linky-fit/linkstr";
import {
  useAtom,
  useAtomValue,
  useLinkstrCommands,
} from "@linky-fit/linkstr-react";
import { Exit } from "effect";
import React from "react";
import {
  buildProfileGeneralStatus,
  PROFILE_STATUS_CURRENCIES,
  type ProfileStatusCurrency,
  parseProfileGeneralStatus,
} from "../../../nostrStatus";
import { saveCachedStatus } from "../../../profileCache";
import { nowSeconds } from "../../../utils/time";
import { runWrite } from "../../lib/storeWrite";
import {
  myProfileAtom,
  profileStatusSavingAtom,
} from "../../state/contacts/profiles";
import { currentNpubAtom, currentNsecAtom } from "../../state/session/session";
import { useSetting, useSettingsRepository } from "../useLinksync";
import { useSetStatus, useTranslation } from "../shell";
import { useUpdateMyProfile } from "./useProfileEditor";
import { useOwnProxyPaymentCurrencies } from "./useProxyPaymentCurrencies";

interface UseProfileStatusEditorResult {
  profileStatusCurrencies: readonly ProfileStatusCurrency[];
  profileStatusIsSaving: boolean;
  selectedProfileStatusCurrencies: readonly ProfileStatusCurrency[];
  toggleProfileStatusCurrency: (
    currency: ProfileStatusCurrency,
  ) => Promise<void>;
}

/**
 * The currencies the user pays bank transfers in for their contacts, and
 * toggling one: the synced setting the listings document names them from,
 * and the profile status contacts on older releases still read them in.
 */
export const useProfileStatusEditor = (): UseProfileStatusEditorResult => {
  const { t } = useTranslation();
  const setStatus = useSetStatus();
  const currentNpub = useAtomValue(currentNpubAtom);
  const currentNsec = useAtomValue(currentNsecAtom);
  const myProfileStatus = useAtomValue(myProfileAtom, (my) => my.status);
  const updateMyProfile = useUpdateMyProfile();
  const setMyProfileStatus = React.useCallback(
    (status: string | null) => updateMyProfile({ status }),
    [updateMyProfile],
  );
  const [profileStatusIsSaving, setProfileStatusIsSaving] = useAtom(
    profileStatusSavingAtom,
  );

  const { publishStatus } = useLinkstrCommands();
  const settingsRepository = useSettingsRepository();
  const currenciesSetting = useSetting("proxyPaymentCurrencies");
  const selectedProfileStatusCurrencies = useOwnProxyPaymentCurrencies();

  const toggleProfileStatusCurrency = React.useCallback(
    async (currency: ProfileStatusCurrency) => {
      if (profileStatusIsSaving) return;
      if (!currentNpub || !currentNsec) {
        setStatus(t("profileMissingNpub"));
        return;
      }

      const currentSelection = selectedProfileStatusCurrencies;
      const nextSelection = currentSelection.includes(currency)
        ? currentSelection.filter((value) => value !== currency)
        : [...currentSelection, currency];
      const restoreSetting = () =>
        runWrite(
          currenciesSetting === null
            ? settingsRepository.remove("proxyPaymentCurrencies")
            : settingsRepository.set(
                "proxyPaymentCurrencies",
                currenciesSetting,
              ),
        );
      const nextStatus = buildProfileGeneralStatus({
        currencies: nextSelection,
        text: parseProfileGeneralStatus(myProfileStatus).text,
      });
      const previousStatus = myProfileStatus;

      setMyProfileStatus(nextStatus);
      setProfileStatusIsSaving(true);

      try {
        const written = await runWrite(
          settingsRepository.set("proxyPaymentCurrencies", nextSelection),
        );
        if (!written.ok) throw new Error(written.error);
        const exit = await publishStatus(
          new StatusDraft({ content: nextStatus ?? "" }),
        );
        if (Exit.isFailure(exit)) {
          await restoreSetting();
          throw new Error("publish failed");
        }
        saveCachedStatus(currentNpub, nextStatus ?? "", nowSeconds());
      } catch (error) {
        setMyProfileStatus(previousStatus);
        setStatus(`${t("errorPrefix")}: ${String(error ?? "unknown")}`);
      } finally {
        setProfileStatusIsSaving(false);
      }
    },
    [
      currenciesSetting,
      currentNpub,
      currentNsec,
      myProfileStatus,
      profileStatusIsSaving,
      publishStatus,
      selectedProfileStatusCurrencies,
      settingsRepository,
      setMyProfileStatus,
      setProfileStatusIsSaving,
      setStatus,
      t,
    ],
  );

  return {
    profileStatusCurrencies: PROFILE_STATUS_CURRENCIES,
    profileStatusIsSaving,
    selectedProfileStatusCurrencies,
    toggleProfileStatusCurrency,
  };
};
