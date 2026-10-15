import { Atom } from "effect/reactivity";

export interface Arm<A> {
  readonly arm: (value: A) => void;
  readonly disarm: () => void;
}

/**
 * A two-tap action's first tap: `valueAtom` holds what was armed until
 * `durationMs` pass or `disarm` runs.
 */
export const armAtoms = <A>(durationMs: number) => {
  const valueAtom = Atom.keepAlive(Atom.make<A | null>(null));
  const commandsAtom = Atom.keepAlive(
    Atom.readable((get): Arm<A> => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const clearTimer = () => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
      };
      get.addFinalizer(clearTimer);
      return {
        arm: (value) => {
          clearTimer();
          get.registry.set(valueAtom, value);
          timer = setTimeout(() => {
            timer = null;
            get.registry.set(valueAtom, null);
          }, durationMs);
        },
        disarm: () => {
          clearTimer();
          get.registry.set(valueAtom, null);
        },
      };
    }),
  );
  return { commandsAtom, valueAtom };
};
