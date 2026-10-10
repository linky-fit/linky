import { Option } from "effect";
import { Atom } from "effect/reactivity";
import type { EvoluPlatform, PlatformPorts } from "../../platform/ports";

// Holds only the value `makeAppRegistry` seeds; reading it unseeded is a bug.
const seededAtom = <A>(name: string): Atom.Atom<A> =>
  Atom.keepAlive(
    Atom.readable((get) =>
      Option.getOrThrowWith(
        get.self<A>(),
        () => new Error(`${name} is seeded by makeAppRegistry`),
      ),
    ),
  );

export const platformAtom = seededAtom<PlatformPorts>("platformAtom");

/** Seeded only for a signed-in session, which is the only one that opens the database. */
export const evoluPlatformAtom = seededAtom<EvoluPlatform | null>(
  "evoluPlatformAtom",
);
