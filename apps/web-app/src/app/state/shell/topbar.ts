import { Atom } from "effect/reactivity";

/** The transactions top bar toggle: hidden transactions are listed too. */
export const hiddenTransactionsShownAtom = Atom.keepAlive(Atom.make(false));
