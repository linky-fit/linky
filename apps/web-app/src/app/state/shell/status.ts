import { Atom } from "effect/reactivity";

/** A one-line status a screen reports; `useStatusToasts` shows it as a toast and clears it. */
export const statusAtom = Atom.keepAlive(Atom.make<string | null>(null));
