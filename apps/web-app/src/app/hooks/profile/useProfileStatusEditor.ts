import { StatusDraft } from "@linky/linkstr";
import { publishStatusAtom, useAtomSet } from "@linky/linkstr-react";
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
import type { Translate } from "../../../i18n";

interface UseProfileStatusEditorParams {
  currentNpub: string | null;
  currentNsec: string | null;
  myProfileStatus: string | null;
  setMyProfileStatus: React.Dispatch<React.SetStateAction<string | null>>;
  setStatus: React.Dispatch<React.SetStateAction<string | null>>;
  t: Translate;
}

interface UseProfileStatusEditorResult {
  profileStatusCurrencies: readonly ProfileStatusCurrency[];
  profileStatusIsSaving: boolean;
  selectedProfileStatusCurrencies: readonly ProfileStatusCurrency[];
  toggleProfileStatusCurrency: (
    currency: ProfileStatusCurrency,
  ) => Promise<void>;
}

export const useProfileStatusEditor = ({
  currentNpub,
  currentNsec,
  myProfileStatus,
  setMyProfileStatus,
  setStatus,
  t,
}: UseProfileStatusEditorParams): UseProfileStatusEditorResult => {
  const [profileStatusIsSaving, setProfileStatusIsSaving] =
    React.useState(false);

  const publishStatus = useAtomSet(publishStatusAtom, { mode: "promiseExit" });

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
