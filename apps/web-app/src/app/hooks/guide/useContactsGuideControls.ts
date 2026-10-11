import {
  RegistryContext,
  useAtom,
  useAtomValue,
} from "@linky-fit/linkstr-react";
import React from "react";
import {
  activeContactsGuideStep,
  CONTACTS_GUIDE_STEPS,
} from "../../lib/contactsGuideSteps";
import {
  contactsGuideAtom,
  contactsGuideHighlightRectAtom,
  contactsGuideTargetContactIdAtom,
} from "../../state/shell/guide";
import type { ContactsGuideKey } from "../../types/appTypes";

export const useStartContactsGuide = () => {
  const registry = React.useContext(RegistryContext);
  return React.useCallback(
    (task: ContactsGuideKey) => {
      registry.set(contactsGuideTargetContactIdAtom, null);
      registry.set(contactsGuideAtom, { task, step: 0 });
    },
    [registry],
  );
};

export const useStopContactsGuide = () => {
  const registry = React.useContext(RegistryContext);
  return React.useCallback(() => {
    registry.set(contactsGuideTargetContactIdAtom, null);
    registry.set(contactsGuideAtom, null);
  }, [registry]);
};

/** The walkthrough step on screen, with its back, next and skip. */
export const useContactsGuideOverlay = () => {
  const [contactsGuide, setContactsGuide] = useAtom(contactsGuideAtom);
  const highlightRect = useAtomValue(contactsGuideHighlightRectAtom);
  const stop = useStopContactsGuide();
  const back = React.useCallback(
    () =>
      setContactsGuide((prev) =>
        prev ? { ...prev, step: Math.max(prev.step - 1, 0) } : prev,
      ),
    [setContactsGuide],
  );
  const next = React.useCallback(
    () =>
      setContactsGuide((prev) => {
        if (!prev) return prev;
        const max = Math.max(CONTACTS_GUIDE_STEPS[prev.task].length - 1, 0);
        if (prev.step >= max) return null;
        return { ...prev, step: prev.step + 1 };
      }),
    [setContactsGuide],
  );
  return {
    activeStep: activeContactsGuideStep(contactsGuide),
    back,
    highlightRect,
    next,
    stop,
  };
};
