import { Effect, Option } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";

type Subscribe = (listener: () => void) => () => void;

/** A value read whole, and the subscription that reports it may have changed. */
export interface LiveSource<A> {
  readonly all: Effect.Effect<A, unknown>;
  readonly subscribe: Subscribe;
}

/**
 * Counts the changes a repository's subscription reports, through one
 * subscription per repository. A read that re-subscribed on every change
 * would re-read on every unrelated database change too: an Evolu
 * subscription reports the first query change it sees, whichever query.
 */
export const changesAtom = <R, E>(
  repository: Atom.Atom<AsyncResult.AsyncResult<R, E>>,
  subscribe: (repository: R) => Subscribe,
) =>
  Atom.make((get): number => {
    const result = get(repository);
    if (!AsyncResult.isSuccess(result)) return 0;
    get.addFinalizer(
      subscribe(result.value)(() =>
        // Dependents re-read after Evolu's change callback, not inside it.
        queueMicrotask(() =>
          get.setSelf(Option.getOrElse(get.self<number>(), () => 0) + 1),
        ),
      ),
    );
    return 0;
  });

/**
 * A store read kept current: re-read whenever the source reports a change,
 * like `useLiveValue`, and kept for the page so every screen shares it.
 */
export const liveAtom = <R, E, A>(
  repository: Atom.Atom<AsyncResult.AsyncResult<R, E>>,
  source: (repository: R) => LiveSource<A>,
) => {
  const changes = changesAtom(
    repository,
    (current) => source(current).subscribe,
  );
  return Atom.keepAlive(
    Atom.make((get) =>
      Effect.gen(function* () {
        get(changes);
        return yield* source(yield* get.result(repository)).all;
      }),
    ),
  );
};
