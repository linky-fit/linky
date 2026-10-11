import type { ContactId } from "@linky-fit/linksync";
import { Atom } from "effect/reactivity";

/** Where navigation goes next once something the user started settles. */
export interface NavIntents {
  /** The contact whose conversation opened the pay screen, so back and a finished payment return there. */
  readonly contactPayBackToChat: ContactId | null;
  /** The npub of a contact just saved, whose page opens once its row is read back. */
  readonly openSavedContactNpub: string | null;
  /** The feedback contact was just saved; its conversation opens once its row is read back. */
  readonly openFeedbackChat: boolean;
}

export const navIntentsAtom = Atom.keepAlive(
  Atom.make<NavIntents>({
    contactPayBackToChat: null,
    openFeedbackChat: false,
    openSavedContactNpub: null,
  }),
);
