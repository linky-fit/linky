import { useAtom } from "@linky-fit/linkstr-react";
import React from "react";
import type { Route } from "../../../types/route";
import type { Translate } from "../../../i18n";
import {
  contactsOnboardingCelebratingAtom,
  contactsOnboardingDismissedAtom,
} from "../../state/shell/guide";

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

export interface ContactsOnboardingTasksSummary {
  done: number;
  percent: number;
  tasks: readonly ContactsOnboardingTask[];
  total: number;
}

interface ContactsOnboardingProgressInput {
  cashuBalance: number;
  contactsCount: number;
  contactsOnboardingHasBackedUpKeys: boolean;
  contactsOnboardingHasPaid: boolean;
  contactsOnboardingHasSentMessage: boolean;
  t: Translate;
}

export const contactsOnboardingTasksOf = ({
  cashuBalance,
  contactsCount,
  contactsOnboardingHasBackedUpKeys,
  contactsOnboardingHasPaid,
  contactsOnboardingHasSentMessage,
  t,
}: ContactsOnboardingProgressInput): ContactsOnboardingTasksSummary => {
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
};

/**
 * Takes over a dismissal synced from another device, mirrors a local one
 * into the synced setting and closes the checklist once every task is done.
 * Mounted once by the shell.
 */
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
  const [contactsOnboardingDismissed, setContactsOnboardingDismissed] = useAtom(
    contactsOnboardingDismissedAtom,
  );
  const [contactsOnboardingCelebrating, setContactsOnboardingCelebrating] =
    useAtom(contactsOnboardingCelebratingAtom);

  const contactsOnboardingTasks = React.useMemo(
    () =>
      contactsOnboardingTasksOf({
        cashuBalance,
        contactsCount,
        contactsOnboardingHasBackedUpKeys,
        contactsOnboardingHasPaid,
        contactsOnboardingHasSentMessage,
        t,
      }),
    [
      cashuBalance,
      contactsCount,
      contactsOnboardingHasBackedUpKeys,
      contactsOnboardingHasPaid,
      contactsOnboardingHasSentMessage,
      t,
    ],
  );

  const showContactsOnboarding =
    !contactsOnboardingDismissed && routeKind === "contacts";

  React.useEffect(() => {
    if (!contactsOnboardingDismissedSynced) return;
    setContactsOnboardingDismissed(true);
    stopContactsGuide();
  }, [
    contactsOnboardingDismissedSynced,
    stopContactsGuide,
    setContactsOnboardingDismissed,
  ]);

  React.useEffect(() => {
    if (!contactsOnboardingDismissed) return;
    persistContactsOnboardingDismissed();
  }, [contactsOnboardingDismissed, persistContactsOnboardingDismissed]);

  const dismissContactsOnboarding = React.useCallback(() => {
    setContactsOnboardingDismissed(true);
    persistContactsOnboardingDismissed();
    stopContactsGuide();
  }, [
    persistContactsOnboardingDismissed,
    stopContactsGuide,
    setContactsOnboardingDismissed,
  ]);

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
    setContactsOnboardingCelebrating,
  ]);

  return {
    contactsOnboardingCelebrating,
    contactsOnboardingTasks,
    dismissContactsOnboarding,
    showContactsOnboarding,
  };
};
