import type { ContactId } from "@linky-fit/linksync";
import { Atom } from "effect/reactivity";
import { CONTACTS_ONBOARDING_DISMISSED_STORAGE_KEY } from "../../../utils/constants";
import type { ContactsGuideKey } from "../../types/appTypes";
import { kvSeededAtom } from "../platform";

export interface ContactsGuideState {
  readonly step: number;
  readonly task: ContactsGuideKey;
}

/** The onboarding walkthrough the user follows, or null. */
export const contactsGuideAtom = Atom.keepAlive(
  Atom.make<ContactsGuideState | null>(null),
);

/** The contact the pay and message walkthroughs lead to, once the user picked one. */
export const contactsGuideTargetContactIdAtom = Atom.keepAlive(
  Atom.make<ContactId | null>(null),
);

export interface GuideHighlightRect {
  readonly height: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
}

/** Where the walkthrough's current step points on screen. */
export const contactsGuideHighlightRectAtom = Atom.keepAlive(
  Atom.make<GuideHighlightRect | null>(null),
);

/** The contacts onboarding checklist was dismissed on this device. */
export const contactsOnboardingDismissedAtom = kvSeededAtom(
  (kv) => kv.getItem(CONTACTS_ONBOARDING_DISMISSED_STORAGE_KEY) === "1",
  (kv, dismissed) => {
    if (dismissed) kv.setItem(CONTACTS_ONBOARDING_DISMISSED_STORAGE_KEY, "1");
  },
);

/** Every onboarding task is done; the checklist celebrates before it closes. */
export const contactsOnboardingCelebratingAtom = Atom.keepAlive(
  Atom.make(false),
);
