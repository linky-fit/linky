import {
  RegistryContext,
  useAtom,
  useAtomSet,
  useAtomValue,
} from "@linky-fit/linkstr-react";
import React from "react";
import { ContactId } from "../../../evoluIds";
import { navigateTo } from "../../../hooks/useRouting";
import type { Route } from "../../../types/route";
import { CONTACTS_GUIDE_STEPS } from "../../lib/contactsGuideSteps";
import { hasLinkyNameAtom } from "../../state/contacts/onboarding";
import {
  contactsGuideAtom,
  contactsGuideHighlightRectAtom,
  contactsGuideTargetContactIdAtom,
} from "../../state/shell/guide";
import { topupAmountAtom } from "../../state/wallet/topup";
import type {
  ContactRowLike,
  ContactsGuideKey,
  ContactsGuideStep,
} from "../../types/appTypes";
import { useBeacon } from "../useBeacon";
import { useStopContactsGuide } from "./useContactsGuideControls";

/** The tutorial's sample top-up, so the guide can show a real invoice; a typed amount wins. */
const SAMPLE_TOPUP_AMOUNT = "10000";

interface UseContactsGuideParams {
  cashuBalance: number;
  contacts: readonly ContactRowLike[];
  contactsOnboardingHasBackedUpKeys: boolean;
  contactsOnboardingHasPaid: boolean;
  contactsOnboardingHasSentMessage: boolean;
  openNewContactPage: () => void;
  route: Route;
}

const getRouteContactId = (route: Route): ContactId | null => {
  if (
    route.kind === "contact" ||
    route.kind === "contactPay" ||
    route.kind === "contactEdit"
  ) {
    return route.id;
  }
  if (route.kind === "chat") {
    const result = ContactId.fromUnknown(route.id);
    return result.ok ? result.value : null;
  }

  return null;
};

/**
 * Runs the onboarding walkthrough: opens each step's screen, follows the
 * user's navigation to the next step and measures the highlighted element.
 * Mounted once by the shell; screens drive it through `contactsGuideAtom`.
 */
export const useContactsGuide = ({
  cashuBalance,
  contacts,
  contactsOnboardingHasBackedUpKeys,
  contactsOnboardingHasPaid,
  contactsOnboardingHasSentMessage,
  openNewContactPage,
  route,
}: UseContactsGuideParams): void => {
  const registry = React.useContext(RegistryContext);
  const beaconEnabled = useBeacon().enabled;
  const hasLinkyName = useAtomValue(hasLinkyNameAtom);
  const [contactsGuide, setContactsGuide] = useAtom(contactsGuideAtom);
  const [contactsGuideTargetContactId, setContactsGuideTargetContactId] =
    useAtom(contactsGuideTargetContactIdAtom);
  const setContactsGuideHighlightRect = useAtomSet(
    contactsGuideHighlightRectAtom,
  );
  const stopContactsGuide = useStopContactsGuide();

  // Tasks the guide ends on its own once the user completes them.
  const doneByTask = React.useMemo<Partial<Record<ContactsGuideKey, boolean>>>(
    () => ({
      backup_keys: contactsOnboardingHasBackedUpKeys,
      linky_name: hasLinkyName,
      message: contactsOnboardingHasSentMessage,
      pay: contactsOnboardingHasPaid,
      topup: cashuBalance > 0,
    }),
    [
      cashuBalance,
      contactsOnboardingHasBackedUpKeys,
      contactsOnboardingHasPaid,
      contactsOnboardingHasSentMessage,
      hasLinkyName,
    ],
  );

  const contactsGuideSteps = React.useMemo(() => {
    if (!contactsGuide) return null;

    const firstContactId = contacts[0]?.id
      ? ContactId.orThrow(contacts[0].id)
      : null;
    const routeContactId = getRouteContactId(route);

    const targetContactId =
      contactsGuideTargetContactId ?? routeContactId ?? firstContactId;

    const ensureRoute = (kind: Route["kind"], contactId?: ContactId | null) => {
      if (route.kind === kind) {
        if (
          kind === "contact" ||
          kind === "contactPay" ||
          kind === "contactEdit" ||
          kind === "chat"
        ) {
          const currentId = getRouteContactId(route) ?? undefined;

          if (contactId && currentId && currentId !== contactId) {
            if (kind === "contact")
              navigateTo({ route: "contact", id: contactId });
            if (kind === "contactPay") {
              navigateTo({ route: "contactPay", id: contactId });
            }
            if (kind === "contactEdit") {
              navigateTo({ route: "contactEdit", id: contactId });
            }
            if (kind === "chat") navigateTo({ route: "chat", id: contactId });
          }
        }
        return;
      }

      if (kind === "contacts") navigateTo({ route: "contacts" });
      if (kind === "wallet") navigateTo({ route: "wallet" });
      if (kind === "proxyPayments") navigateTo({ route: "proxyPayments" });
      if (kind === "profile") navigateTo({ route: "profile" });
      if (kind === "profileEdit") navigateTo({ route: "profileEdit" });
      if (kind === "settings") navigateTo({ route: "settings" });
      if (kind === "settingsMasterKeys") {
        navigateTo({ route: "settingsMasterKeys" });
      }
      if (kind === "advanced") navigateTo({ route: "advanced" });
      if (kind === "topup") navigateTo({ route: "topup" });
      if (kind === "topupInvoice") {
        registry.update(topupAmountAtom, (amount) =>
          amount.trim() ? amount : SAMPLE_TOPUP_AMOUNT,
        );
        navigateTo({ route: "topupInvoice" });
      }
      if (kind === "contactNew") openNewContactPage();
      if (kind === "contact" && contactId) {
        navigateTo({ route: "contact", id: contactId });
      }
      if (kind === "contactPay" && contactId) {
        navigateTo({ route: "contactPay", id: contactId });
      }
      if (kind === "contactEdit" && contactId) {
        navigateTo({ route: "contactEdit", id: contactId });
      }
      if (kind === "chat" && contactId)
        navigateTo({ route: "chat", id: contactId });
    };

    return CONTACTS_GUIDE_STEPS[contactsGuide.task].map(
      (step): ContactsGuideStep => ({
        ...step,
        ensure: () =>
          ensureRoute(step.route, step.showsTarget ? targetContactId : null),
      }),
    );
  }, [
    contacts,
    contactsGuide,
    contactsGuideTargetContactId,
    openNewContactPage,
    registry,
    route,
  ]);

  const contactsGuideActiveStep = React.useMemo(() => {
    if (!contactsGuide || !contactsGuideSteps) return null;

    const idx = Math.min(
      Math.max(contactsGuide.step, 0),
      Math.max(contactsGuideSteps.length - 1, 0),
    );

    return {
      idx,
      step: contactsGuideSteps[idx] ?? null,
      total: contactsGuideSteps.length,
    };
  }, [contactsGuide, contactsGuideSteps]);

  // Ensure the step's route only when the step becomes active. Re-running
  // ensure on every route change would fight user navigation: following the
  // step instruction (or pressing the system Back button) would immediately
  // navigate back to the previous step's route before the step advances.
  const contactsGuideLastEnsuredStepIdRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    const active = contactsGuideActiveStep?.step ?? null;
    if (!contactsGuide || !active) {
      contactsGuideLastEnsuredStepIdRef.current = null;
      return;
    }

    if (contactsGuideLastEnsuredStepIdRef.current === active.id) return;
    contactsGuideLastEnsuredStepIdRef.current = active.id;

    try {
      active.ensure?.();
    } catch {
      // ignore
    }
  }, [contactsGuide, contactsGuideActiveStep]);

  const contactsGuidePrevRouteRef = React.useRef<{
    id: string | null;
    kind: Route["kind"];
  } | null>(null);

  React.useEffect(() => {
    if (!contactsGuide || !contactsGuideActiveStep?.step) {
      contactsGuidePrevRouteRef.current = {
        kind: route.kind,
        id: getRouteContactId(route) ? String(getRouteContactId(route)) : null,
      };
      return;
    }

    const prev = contactsGuidePrevRouteRef.current;
    const current = {
      kind: route.kind,
      id: getRouteContactId(route) ? String(getRouteContactId(route)) : null,
    };

    contactsGuidePrevRouteRef.current = current;

    const id = contactsGuideActiveStep.step.id;

    const goToStep = (step: number) => {
      setContactsGuide((prevGuide) => {
        if (!prevGuide) return prevGuide;
        if (prevGuide.task !== contactsGuide.task) return prevGuide;
        if (prevGuide.step === step) return prevGuide;
        return { ...prevGuide, step };
      });
    };

    const transition = (from: Route["kind"], to: Route["kind"]) =>
      Boolean(prev && prev.kind === from && current.kind === to);

    // A contact card opens the conversation; that contact is the guide's
    // target from then on.
    if (
      (contactsGuide.task === "pay" ||
        contactsGuide.task === "message" ||
        contactsGuide.task === "groups") &&
      transition("contacts", "chat") &&
      current.id
    ) {
      setContactsGuideTargetContactId(ContactId.orThrow(current.id));
    }

    if (id === "add_contact_1" && transition("contacts", "profile")) {
      goToStep(1);
    }
    if (id === "add_contact_2" && transition("profile", "contacts")) {
      goToStep(2);
    }
    if (id === "add_contact_3" && transition("contacts", "contactNew")) {
      goToStep(3);
    }
    if (
      id === "add_contact_4" &&
      prev &&
      prev.kind === "contactNew" &&
      current.kind !== "contactNew"
    ) {
      stopContactsGuide();
    }

    if (id === "topup_1" && transition("contacts", "wallet")) goToStep(1);
    if (id === "topup_2" && transition("wallet", "topup")) goToStep(2);
    if (id === "topup_3" && transition("topup", "topupInvoice")) goToStep(3);

    if (id === "pay_1" && transition("contacts", "chat")) goToStep(1);
    if (id === "pay_2" && transition("chat", "contactPay")) goToStep(2);

    if (id === "message_1" && transition("contacts", "chat")) goToStep(1);

    if (id === "linky_name_1" && transition("contacts", "profile")) {
      goToStep(1);
    }
    if (id === "linky_name_2" && transition("profile", "profileEdit")) {
      goToStep(2);
    }

    if (id === "groups_1" && transition("contacts", "chat")) goToStep(1);
    if (id === "groups_2" && transition("chat", "contactEdit")) goToStep(2);
    // Saving or leaving the edit form ends the group part; what is left is
    // mentioning the group in a conversation.
    if (
      id === "groups_3" &&
      prev &&
      prev.kind === "contactEdit" &&
      current.kind !== "contactEdit"
    ) {
      goToStep(3);
    }

    if (
      (id === "proxy_payment_1" || id === "beacon_1") &&
      transition("contacts", "proxyPayments")
    ) {
      goToStep(1);
    }
    if (id === "beacon_2" && beaconEnabled && !contactsGuide.doneAtStart) {
      goToStep(2);
    }

    if (id === "backup_keys_1" && transition("contacts", "settings")) {
      goToStep(1);
    }
    if (
      id === "backup_keys_2" &&
      transition("settings", "settingsMasterKeys")
    ) {
      goToStep(2);
    }

    if (!contactsGuide.doneAtStart && doneByTask[contactsGuide.task]) {
      stopContactsGuide();
    }
  }, [
    beaconEnabled,
    contactsGuide,
    contactsGuideActiveStep?.step,
    doneByTask,
    route,
    stopContactsGuide,
    setContactsGuideTargetContactId,
    setContactsGuide,
  ]);

  const contactsGuideActiveSelector =
    contactsGuideActiveStep?.step.selector ?? null;
  const contactsGuideActiveStepId = contactsGuideActiveStep?.step.id ?? null;

  React.useEffect(() => {
    if (!contactsGuideActiveSelector) {
      setContactsGuideHighlightRect(null);
      return;
    }

    const el = document.querySelector(contactsGuideActiveSelector);
    if (!(el instanceof HTMLElement)) return;
    try {
      el.scrollIntoView({ block: "center", inline: "center" });
    } catch {
      // ignore
    }
  }, [
    contactsGuideActiveSelector,
    contactsGuideActiveStepId,
    setContactsGuideHighlightRect,
  ]);

  React.useEffect(() => {
    if (!contactsGuideActiveSelector) return;

    let animationFrameId: number | null = null;
    const updateRect = () => {
      animationFrameId = null;
      const el = document.querySelector(contactsGuideActiveSelector);
      if (!(el instanceof HTMLElement)) {
        setContactsGuideHighlightRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      const pad = 8;
      setContactsGuideHighlightRect({
        top: Math.max(r.top - pad, 8),
        left: Math.max(r.left - pad, 8),
        width: Math.min(r.width + pad * 2, window.innerWidth - 16),
        height: Math.min(r.height + pad * 2, window.innerHeight - 16),
      });
    };
    const scheduleUpdateRect = () => {
      if (animationFrameId !== null) return;
      animationFrameId = window.requestAnimationFrame(updateRect);
    };

    scheduleUpdateRect();

    window.addEventListener("resize", scheduleUpdateRect);
    window.addEventListener("scroll", scheduleUpdateRect, { passive: true });
    return () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }
      window.removeEventListener("resize", scheduleUpdateRect);
      window.removeEventListener("scroll", scheduleUpdateRect);
    };
  }, [contactsGuideActiveSelector, route.kind, setContactsGuideHighlightRect]);
};
