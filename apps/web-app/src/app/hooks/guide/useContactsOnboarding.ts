import { useAtom, useAtomValue } from "@linky-fit/linkstr-react";
import React from "react";
import { useRouting } from "../../../hooks/useRouting";
import { runWrite } from "../../lib/storeWrite";
import {
  contactsOnboardingHasBackedUpKeysAtom,
  contactsOnboardingHasPaidAtom,
  contactsOnboardingHasSentMessageAtom,
} from "../../state/contacts/onboarding";
import { contactsAtom } from "../../state/contacts/readModel";
import {
  contactsOnboardingCelebratingAtom,
  contactsOnboardingDismissedAtom,
} from "../../state/shell/guide";
import { useTranslation } from "../shell";
import { useSetting, useSettingsRepository } from "../useLinksync";
import { useWalletBalance } from "../wallet/useWalletInventory";
import { useStopContactsGuide } from "./useContactsGuideControls";
import {
  contactsOnboardingTasksOf,
  useContactsOnboardingExtras,
} from "./useContactsOnboardingProgress";

/** Mirrors a dismissal into the synced setting, so the user's other devices hide the checklist too. */
export const usePersistContactsOnboardingDismissed = () => {
  const settingsRepository = useSettingsRepository();
  const dismissedSynced = useSetting("onboardingTutorial") === "dismissed";
  return React.useCallback(() => {
    if (dismissedSynced) return;
    void runWrite(settingsRepository.set("onboardingTutorial", "dismissed"));
  }, [dismissedSynced, settingsRepository]);
};

/** The contacts onboarding checklist as the contacts tab shows it. */
export const useContactsOnboarding = () => {
  const route = useRouting();
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useAtom(contactsOnboardingDismissedAtom);
  const celebrating = useAtomValue(contactsOnboardingCelebratingAtom);
  const contactsCount = useAtomValue(contactsAtom).length;
  const hasBackedUpKeys = useAtomValue(contactsOnboardingHasBackedUpKeysAtom);
  const hasPaid = useAtomValue(contactsOnboardingHasPaidAtom);
  const hasSentMessage = useAtomValue(contactsOnboardingHasSentMessageAtom);
  const { cashuBalance } = useWalletBalance();
  const persistDismissed = usePersistContactsOnboardingDismissed();
  const stopContactsGuide = useStopContactsGuide();
  const extras = useContactsOnboardingExtras();

  const tasks = React.useMemo(
    () =>
      contactsOnboardingTasksOf({
        ...extras,
        cashuBalance,
        contactsCount,
        contactsOnboardingHasBackedUpKeys: hasBackedUpKeys,
        contactsOnboardingHasPaid: hasPaid,
        contactsOnboardingHasSentMessage: hasSentMessage,
        t,
      }),
    [
      cashuBalance,
      contactsCount,
      extras,
      hasBackedUpKeys,
      hasPaid,
      hasSentMessage,
      t,
    ],
  );

  const dismissContactsOnboarding = React.useCallback(() => {
    setDismissed(true);
    persistDismissed();
    stopContactsGuide();
  }, [persistDismissed, setDismissed, stopContactsGuide]);

  return {
    contactsOnboardingCelebrating: celebrating,
    contactsOnboardingTasks: tasks,
    dismissContactsOnboarding,
    showContactsOnboarding: !dismissed && route.kind === "contacts",
  };
};
