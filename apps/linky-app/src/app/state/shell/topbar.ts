import { Atom } from "effect/reactivity";

/** The wallet history's toggle: hidden transactions are listed too. */
export const hiddenTransactionsShownAtom = Atom.keepAlive(Atom.make(false));

/** The main tab the back button and closing Settings return to. */
export const mainReturnTabAtom = Atom.keepAlive(
  Atom.make<"contacts" | "wallet">("contacts"),
);
