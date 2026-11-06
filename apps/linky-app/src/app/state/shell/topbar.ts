import { Atom } from "effect/reactivity";

/** The main tab the back button and closing Settings return to. */
export const mainReturnTabAtom = Atom.keepAlive(
  Atom.make<"contacts" | "wallet">("contacts"),
);
