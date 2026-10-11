import { Effect } from "effect";
import { Atom, type AsyncResult } from "effect/reactivity";

/** A value read whole, and the subscription that reports it may have changed. */
export interface LiveSource<A> {
  readonly all: Effect.Effect<A, unknown>;
  readonly subscribe: (listener: () => void) => () => void;
}

/**
 * A store read kept current: re-read whenever the source reports a change,
 * like `useLiveValue`, and kept for the page so every screen shares it.
 */
export const liveAtom = <R, E, A>(
  repository: Atom.Atom<AsyncResult.AsyncResult<R, E>>,
  source: (repository: R) => LiveSource<A>,
) =>
  Atom.keepAlive(
    Atom.make((get) =>
      Effect.gen(function* () {
        const { all, subscribe } = source(yield* get.result(repository));
        // As in walletReadModelAtom: a refresh inside the store's notify loop would re-notify forever.
        get.addFinalizer(
          subscribe(() => queueMicrotask(() => get.refreshSelf())),
        );
        return yield* all;
      }),
    ),
  );
