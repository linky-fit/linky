import { useAtom, useAtomValue } from "@linky-fit/linkstr-react";
import React from "react";
import type { Route } from "../../../types/route";
import type { Translate } from "../../../i18n";
import {
  hasContactGroupsAtom,
  hasLinkyNameAtom,
  hasProxyPaymentSetupAtom,
} from "../../state/contacts/onboarding";
import {
  contactsOnboardingCelebratingAtom,
  contactsOnboardingDismissedAtom,
} from "../../state/shell/guide";
import type { ContactsGuideKey } from "../../types/appTypes";
import { useBeacon, useBeaconSupport } from "../useBeacon";

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

export interface ContactsOnboardingTask {
  done: boolean;
  key: ContactsGuideKey;
  label: string;
}

export interface ContactsOnboardingTasksSummary {
  done: number;
  percent: number;
  tasks: readonly ContactsOnboardingTask[];
  total: number;
}

/** The onboarding tasks that are not a tutorial step of their own: read from atoms and the beacon. */
export interface ContactsOnboardingExtras {
  beaconEnabled: boolean;
  /** The beacon task is listed only where a beacon can run (native shell). */
  beaconSupported: boolean;
  hasContactGroups: boolean;
  /** The user owns a name@linky.fit lightning address. */
  hasLinkyName: boolean;
  hasProxyPaymentSetup: boolean;
}

interface ContactsOnboardingProgressInput extends ContactsOnboardingExtras {
  cashuBalance: number;
  contactsCount: number;
  contactsOnboardingHasBackedUpKeys: boolean;
  contactsOnboardingHasPaid: boolean;
  contactsOnboardingHasSentMessage: boolean;
  t: Translate;
}

export const useContactsOnboardingExtras = (): ContactsOnboardingExtras => {
  const beaconEnabled = useBeacon().enabled;
  const beaconSupported = useBeaconSupport();
  const hasContactGroups = useAtomValue(hasContactGroupsAtom);
  const hasLinkyName = useAtomValue(hasLinkyNameAtom);
  const hasProxyPaymentSetup = useAtomValue(hasProxyPaymentSetupAtom);
  return React.useMemo(
    () => ({
      beaconEnabled,
      beaconSupported,
      hasContactGroups,
      hasLinkyName,
      hasProxyPaymentSetup,
    }),
    [
      beaconEnabled,
      beaconSupported,
      hasContactGroups,
      hasLinkyName,
      hasProxyPaymentSetup,
    ],
  );
};

export const contactsOnboardingTasksOf = ({
  beaconEnabled,
  beaconSupported,
  cashuBalance,
  contactsCount,
  contactsOnboardingHasBackedUpKeys,
  contactsOnboardingHasPaid,
  contactsOnboardingHasSentMessage,
  hasContactGroups,
  hasLinkyName,
  hasProxyPaymentSetup,
  t,
}: ContactsOnboardingProgressInput): ContactsOnboardingTasksSummary => {
  const tasks: ContactsOnboardingTask[] = [
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
    {
      key: "linky_name",
      label: t("contactsOnboardingTaskLinkyName"),
      done: hasLinkyName,
    },
    {
      key: "groups",
      label: t("contactsOnboardingTaskGroups"),
      done: hasContactGroups,
    },
    {
      key: "proxy_payment",
      label: t("contactsOnboardingTaskProxyPayment"),
      done: hasProxyPaymentSetup,
    },
    ...(beaconSupported
      ? [
          {
            key: "beacon" as const,
            label: t("contactsOnboardingTaskBeacon"),
            done: beaconEnabled,
          },
        ]
      : []),
  ];

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
  const {
    beaconEnabled,
    beaconSupported,
    hasContactGroups,
    hasLinkyName,
    hasProxyPaymentSetup,
  } = useContactsOnboardingExtras();

  const contactsOnboardingTasks = React.useMemo(
    () =>
      contactsOnboardingTasksOf({
        beaconEnabled,
        beaconSupported,
        cashuBalance,
        contactsCount,
        contactsOnboardingHasBackedUpKeys,
        contactsOnboardingHasPaid,
        contactsOnboardingHasSentMessage,
        hasContactGroups,
        hasLinkyName,
        hasProxyPaymentSetup,
        t,
      }),
    [
      beaconEnabled,
      beaconSupported,
      cashuBalance,
      contactsCount,
      contactsOnboardingHasBackedUpKeys,
      contactsOnboardingHasPaid,
      contactsOnboardingHasSentMessage,
      hasContactGroups,
      hasLinkyName,
      hasProxyPaymentSetup,
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
