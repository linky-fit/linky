import { Atom } from "effect/reactivity";

/** The full-screen profile card, opened by flipping the phone top-down. */
export const profileShareOverlayOpenAtom = Atom.keepAlive(Atom.make(false));
