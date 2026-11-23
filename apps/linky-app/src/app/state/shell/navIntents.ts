import type { ContactId } from "@linky-fit/linksync";
import { Atom } from "effect/reactivity";

/** Where navigation goes next once something the user started settles. */
export interface NavIntents {
  /** Returns to Advanced when Tokens was opened from there instead of Wallet. */
  readonly cashuTokensBackTo: "advanced" | null;
  /** The contact whose conversation opened the pay screen, so back and a finished payment return there. */
  readonly contactPayBackToChat: ContactId | null;
  /** Returns to Advanced when Evolu data was opened from there instead of Evolu servers. */
  readonly evoluDataBackTo: "advanced" | null;
  /** The npub of a contact just saved, whose page opens once its row is read back. */
  readonly openSavedContactNpub: string | null;
  /** The feedback contact was just saved; its conversation opens once its row is read back. */
  readonly openFeedbackChat: boolean;
}

export const navIntentsAtom = Atom.keepAlive(
  Atom.make<NavIntents>({
    cashuTokensBackTo: null,
    contactPayBackToChat: null,
    evoluDataBackTo: null,
    openFeedbackChat: false,
    openSavedContactNpub: null,
  }),
);
