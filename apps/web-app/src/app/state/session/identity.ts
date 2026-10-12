import type { ProfileMetadata, Pubkey } from "@linky-fit/linkstr";
import { Atom } from "effect/reactivity";
import { getInitialNostrIdentitySource } from "../../../utils/storage";
import type {
  IdentityProfileCheck,
  IdentityProfileSource,
  IdentitySwitchTarget,
} from "../../lib/keySwitchProfile";
import { lazyStateAtom } from "../platform";
import { ownerCommandsAtom } from "../shell/ownerCommands";
import { currentNsecAtom } from "./session";

export type NostrIdentitySource = "custom" | "derived";

export type PendingIdentitySwitch =
  | {
      phase: "checking" | "switching";
      npub: string;
      pubkey: Pubkey;
      target: IdentitySwitchTarget;
    }
  | {
      phase: "choosing";
      check: Exclude<IdentityProfileCheck, { kind: "none" }>;
      lightningAddress: string;
      linkyProfile: ProfileMetadata;
      npub: string;
      nsec: string;
      pubkey: Pubkey;
      target: IdentitySwitchTarget;
    };

/** The recovery seed as stored on this device, null until read or when absent. */
export const slip39SeedAtom = Atom.keepAlive(Atom.make<string | null>(null));

export const seedMnemonicAtom = Atom.readable(
  (get) => (get(slip39SeedAtom) ?? "").trim() || null,
);

/** The identity the recovery seed derives, null without a seed. */
export const defaultNsecAtom = Atom.keepAlive(Atom.make<string | null>(null));
export const defaultNpubAtom = Atom.keepAlive(Atom.make<string | null>(null));

/** Whether the derived identity or a pasted custom one is in use. */
export const nostrIdentitySourceAtom = lazyStateAtom<NostrIdentitySource>(() =>
  getInitialNostrIdentitySource(),
);

/** The custom identity kept on this device, in use or not; null when none is attached. */
export const attachedNsecAtom = Atom.keepAlive(Atom.make<string | null>(null));
export const attachedNpubAtom = Atom.keepAlive(Atom.make<string | null>(null));

/** A custom identity is active, so the seed's own identity can be switched back to. */
export const canSwitchToDefaultIdentityAtom = Atom.readable((get) => {
  const defaultNsec = get(defaultNsecAtom);
  return (
    defaultNsec !== null && defaultNsec !== (get(currentNsecAtom) ?? "").trim()
  );
});

/** Logout was tapped once; a second tap within 5 s logs out. */
export const logoutArmedAtom = Atom.keepAlive(Atom.make(false));

export const pendingIdentitySwitchAtom = Atom.keepAlive(
  Atom.make<PendingIdentitySwitch | null>(null),
);

export interface IdentityCommands {
  readonly answerPendingIdentitySwitch: (
    source: IdentityProfileSource | null,
  ) => Promise<void>;
  readonly requestLogout: (options: { evoluConnected: boolean }) => void;
  readonly requestPasteNostrKeys: () => Promise<void>;
  /** Forgets the attached custom identity; refused while it is in use. */
  readonly removeAttachedIdentity: () => Promise<void>;
  readonly switchToAttachedIdentity: () => Promise<void>;
  readonly switchToDefaultIdentity: () => Promise<void>;
}

/** The signed-in shell's identity switches and logout. */
export const identityCommandsAtom = ownerCommandsAtom<IdentityCommands>();
