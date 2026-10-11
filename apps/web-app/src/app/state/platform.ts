import { Option } from "effect";
import { Atom } from "effect/reactivity";
import type {
  EvoluPlatform,
  KeyValuePort,
  PlatformPorts,
} from "../../platform/ports";

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

/**
 * Page-lifetime state that starts from what `read` finds in the device's
 * key-value storage; `persist`, when given, stores every write, and with
 * `persistSeed` also the seed, so storage holds the normalized value.
 */
export const kvSeededAtom = <A>(
  read: (kv: KeyValuePort) => A,
  persist?: (kv: KeyValuePort, value: A) => void,
  { persistSeed = false }: { readonly persistSeed?: boolean } = {},
): Atom.Writable<A> =>
  Atom.keepAlive(
    Atom.writable(
      (get) =>
        Option.getOrElse(get.self<A>(), () => {
          const kv = get(platformAtom).kv;
          const seed = read(kv);
          if (persistSeed) persist?.(kv, seed);
          return seed;
        }),
      (ctx, value: A) => {
        persist?.(ctx.get(platformAtom).kv, value);
        ctx.setSelf(value);
      },
    ),
  );

/** Seeded only for a signed-in session, which is the only one that opens the database. */
export const evoluPlatformAtom = seededAtom<EvoluPlatform | null>(
  "evoluPlatformAtom",
);
