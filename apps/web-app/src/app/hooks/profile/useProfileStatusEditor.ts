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
import {
  myProfileAtom,
  profileStatusSavingAtom,
} from "../../state/contacts/profiles";
import { currentNpubAtom, currentNsecAtom } from "../../state/session/session";
import { useSetStatus, useTranslation } from "../shell";
import { useUpdateMyProfile } from "./useProfileEditor";

interface UseProfileStatusEditorResult {
  profileStatusCurrencies: readonly ProfileStatusCurrency[];
  profileStatusIsSaving: boolean;
  selectedProfileStatusCurrencies: readonly ProfileStatusCurrency[];
  toggleProfileStatusCurrency: (
    currency: ProfileStatusCurrency,
  ) => Promise<void>;
}

/** The currencies the own status offers, and toggling one, which publishes the status. */
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

  const selectedProfileStatusCurrencies = React.useMemo(
    () => parseProfileGeneralStatus(myProfileStatus).currencies,
    [myProfileStatus],
  );

  const toggleProfileStatusCurrency = React.useCallback(
    async (currency: ProfileStatusCurrency) => {
      if (profileStatusIsSaving) return;
      if (!currentNpub || !currentNsec) {
        setStatus(t("profileMissingNpub"));
        return;
      }

      const currentSelection =
        parseProfileGeneralStatus(myProfileStatus).currencies;
      const nextSelection = currentSelection.includes(currency)
        ? currentSelection.filter((value) => value !== currency)
        : [...currentSelection, currency];
      const nextStatus = buildProfileGeneralStatus({
        currencies: nextSelection,
        text: parseProfileGeneralStatus(myProfileStatus).text,
      });
      const previousStatus = myProfileStatus;

      setMyProfileStatus(nextStatus);
      setProfileStatusIsSaving(true);

      try {
        const exit = await publishStatus(
          new StatusDraft({ content: nextStatus ?? "" }),
        );
        if (Exit.isFailure(exit)) throw new Error("publish failed");
        saveCachedStatus(currentNpub, nextStatus ?? "", nowSeconds());
      } catch (error) {
        setMyProfileStatus(previousStatus);
        setStatus(`${t("errorPrefix")}: ${String(error ?? "unknown")}`);
      } finally {
        setProfileStatusIsSaving(false);
      }
    },
    [
      currentNpub,
      currentNsec,
      myProfileStatus,
      profileStatusIsSaving,
      publishStatus,
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
