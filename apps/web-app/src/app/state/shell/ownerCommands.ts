import { Atom } from "effect/reactivity";

/** The latest commands of a once-mounted owner, read when a command runs. */
export interface OwnerCommands<C> {
  readonly read: () => C;
}

/**
 * Commands whose implementation stays with the hook that owns their state
 * and is mounted once; null until that owner mounts and after it unmounts.
 */
export const ownerCommandsAtom = <C>() =>
  Atom.keepAlive(Atom.make<OwnerCommands<C> | null>(null));
