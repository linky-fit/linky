import { Atom } from "effect/reactivity";

/** The full-screen profile card, opened by flipping the phone top-down. */
export const profileShareOverlayOpenAtom = Atom.keepAlive(Atom.make(false));

/** Text waiting in the share options sheet, shown where no share sheet exists. */
export const shareOptionsTextAtom = Atom.keepAlive(
  Atom.make<string | null>(null),
);

export type NfcWritePromptKind = "profile" | "token";

/** The web NFC prompt while a write waits for a tag. */
export const nfcWritePromptKindAtom = Atom.keepAlive(
  Atom.make<NfcWritePromptKind | null>(null),
);

/** The user cancelled the pending NFC write, so its cancelled result is not reported. */
export const nfcWriteCancelledByUserAtom = Atom.keepAlive(Atom.make(false));
