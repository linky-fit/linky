import type { ContactId } from "@linky-fit/linksync";
import { Atom } from "effect/reactivity";
import type { ContactSuggestionCandidate } from "../../hooks/contacts/useContactSuggestions";
import type { ContactFormState } from "../../types/appTypes";

/** The edited contact's fields as the edit form opened with them. */
export interface ContactEditInitial {
  readonly groups: string[];
  readonly id: ContactId;
  readonly lnAddress: string;
  readonly name: string;
  readonly npub: string;
}

/** The new/edit contact form, kept across navigation until it is cleared. */
export interface ContactFormDraft {
  readonly form: ContactFormState;
  readonly editingId: ContactId | null;
  readonly initial: ContactEditInitial | null;
  readonly saving: boolean;
}

export const makeEmptyContactForm = (): ContactFormState => ({
  name: "",
  npub: "",
  lnAddress: "",
  groups: [],
});

export const contactFormAtom = Atom.keepAlive(
  Atom.make<ContactFormDraft>({
    form: makeEmptyContactForm(),
    editingId: null,
    initial: null,
    saving: false,
  }),
);

/** What the next new-contact form opens with, such as a just-paid lightning address. */
export interface ContactNewPrefill {
  readonly lnAddress: string;
  readonly npub: string | null;
  readonly suggestedName: string | null;
}

export const contactNewPrefillAtom = Atom.keepAlive(
  Atom.make<ContactNewPrefill | null>(null),
);

/** The contact just added, pinned to the top of the list. */
export const recentlyAddedContactIdAtom = Atom.keepAlive(
  Atom.make<ContactId | null>(null),
);

/** New Linky users offered on the new-contact screen; empty off that screen. */
export const contactSuggestionsAtom = Atom.keepAlive(
  Atom.make<ReadonlyArray<ContactSuggestionCandidate>>([]),
);

/** A duplicate-contact merge runs; another tap meanwhile is ignored. */
export const dedupeContactsBusyAtom = Atom.keepAlive(Atom.make(false));
