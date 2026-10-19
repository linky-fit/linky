import { Atom } from "effect/reactivity";

/** A switch to new keys the secure store refused to keep; the keys stay in memory until it is retried or cancelled. */
export interface SecretsWriteFailure {
  /** The backup words the keys derive from, for the user to write down. */
  readonly backupWords: string;
  /** Stores the keys again and reloads into them; false when the store refused again. */
  readonly retry: () => Promise<boolean>;
}

export const secretsWriteFailureAtom = Atom.keepAlive(
  Atom.make<SecretsWriteFailure | null>(null),
);
