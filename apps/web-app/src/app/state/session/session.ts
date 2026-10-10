import { encodeNpub, identityFromNsec } from "@linky-fit/linkstr";
import { Atom } from "effect/reactivity";
import type { SessionSecrets, SessionState } from "../../../platform/session";

export type { SessionSecrets, SessionState };

/** Seeded at boot from `loadSession`; an identity switch, restore or logout reloads the page. */
export const sessionAtom = Atom.keepAlive(
  Atom.make<SessionState>({ _tag: "SignedOut" }),
);

export const sessionSecrets = (session: SessionState): SessionSecrets | null =>
  session._tag === "SignedIn" ? session.secrets : null;

export const currentNsecAtom = Atom.make(
  (get) => sessionSecrets(get(sessionAtom))?.nsec ?? null,
);

export const currentNpubAtom = Atom.make((get) => {
  const nsec = get(currentNsecAtom)?.trim();
  const identity = nsec ? identityFromNsec(nsec) : null;
  return identity === null ? null : encodeNpub(identity.pubkey);
});
