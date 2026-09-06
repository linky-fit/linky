import React from "react";
import type { Route } from "../../../types/route";
import { CONTACTS_ONBOARDING_DISMISSED_STORAGE_KEY } from "../../../utils/constants";
import {
  safeLocalStorageGet,
  safeLocalStorageSet,
} from "../../../utils/storage";
import type { Translate } from "../../../i18n";

interface UseContactsOnboardingProgressParams {
  cashuBalance: number;
  contactsCount: number;
  contactsOnboardingDismissedSynced: boolean;
  contactsOnboardingHasBackedUpKeys: boolean;
  contactsOnboardingHasPaid: boolean;
  contactsOnboardingHasSentMessage: boolean;
  persistContactsOnboardingDismissed: () => void;
  routeKind: Route["kind"];
  stopContactsGuide: () => void;
  t: Translate;
}

interface ContactsOnboardingTask {
  done: boolean;
  key: string;
  label: string;
}

interface ContactsOnboardingTasksSummary {
  done: number;
  percent: number;
  tasks: readonly ContactsOnboardingTask[];
  total: number;
}

export const useContactsOnboardingProgress = ({
  cashuBalance,
  contactsCount,
  contactsOnboardingDismissedSynced,
  contactsOnboardingHasBackedUpKeys,
  contactsOnboardingHasPaid,
  contactsOnboardingHasSentMessage,
  persistContactsOnboardingDismissed,
  routeKind,
  stopContactsGuide,
  t,
}: UseContactsOnboardingProgressParams) => {
  const [contactsOnboardingDismissed, setContactsOnboardingDismissed] =
    React.useState<boolean>(
      () =>
        safeLocalStorageGet(CONTACTS_ONBOARDING_DISMISSED_STORAGE_KEY) === "1",
    );
  const [contactsOnboardingCelebrating, setContactsOnboardingCelebrating] =
    React.useState(false);

  const contactsOnboardingTasks =
    React.useMemo<ContactsOnboardingTasksSummary>(() => {
      const tasks = [
        {
          key: "add_contact",
          label: t("contactsOnboardingTaskAddContact"),
          done: contactsCount > 0,
        },
        {
          key: "message",
          label: t("contactsOnboardingTaskMessage"),
          done: contactsOnboardingHasSentMessage,
        },
        {
          key: "topup",
          label: t("contactsOnboardingTaskTopup"),
          done: cashuBalance > 0,
        },
        {
          key: "backup_keys",
          label: t("contactsOnboardingTaskBackupKeys"),
          done: contactsOnboardingHasBackedUpKeys,
        },
        {
          key: "pay",
          label: t("contactsOnboardingTaskPay"),
          done: contactsOnboardingHasPaid,
        },
      ] as const;

      const done = tasks.reduce((sum, task) => sum + (task.done ? 1 : 0), 0);
      const total = tasks.length;
      const percent = total > 0 ? Math.round((done / total) * 100) : 0;
      return { tasks, done, total, percent };
    }, [
      cashuBalance,
      contactsCount,
      contactsOnboardingHasBackedUpKeys,
      contactsOnboardingHasPaid,
      contactsOnboardingHasSentMessage,
      t,
    ]);

  const showContactsOnboarding =
    !contactsOnboardingDismissed && routeKind === "contacts";

  React.useEffect(() => {
    if (!contactsOnboardingDismissedSynced) return;
    safeLocalStorageSet(CONTACTS_ONBOARDING_DISMISSED_STORAGE_KEY, "1");
    setContactsOnboardingDismissed(true);
    stopContactsGuide();
  }, [contactsOnboardingDismissedSynced, stopContactsGuide]);

  React.useEffect(() => {
    if (!contactsOnboardingDismissed) return;
    persistContactsOnboardingDismissed();
  }, [contactsOnboardingDismissed, persistContactsOnboardingDismissed]);

  const dismissContactsOnboarding = React.useCallback(() => {
    safeLocalStorageSet(CONTACTS_ONBOARDING_DISMISSED_STORAGE_KEY, "1");
    setContactsOnboardingDismissed(true);
    persistContactsOnboardingDismissed();
    stopContactsGuide();
  }, [persistContactsOnboardingDismissed, stopContactsGuide]);

  React.useEffect(() => {
    if (contactsOnboardingDismissed) return;
    if (!showContactsOnboarding) return;
    if (contactsOnboardingCelebrating) return;

    const total = contactsOnboardingTasks.total;
    if (!total) return;
    if (contactsOnboardingTasks.done !== total) return;

    setContactsOnboardingCelebrating(true);
    stopContactsGuide();
    const timeoutId = window.setTimeout(() => {
      dismissContactsOnboarding();
      setContactsOnboardingCelebrating(false);
    }, 1400);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    contactsOnboardingCelebrating,
    contactsOnboardingDismissed,
    contactsOnboardingTasks.done,
    contactsOnboardingTasks.total,
    dismissContactsOnboarding,
    showContactsOnboarding,
    stopContactsGuide,
  ]);

  return {
    contactsOnboardingCelebrating,
    contactsOnboardingTasks,
    dismissContactsOnboarding,
    showContactsOnboarding,
  };
};
