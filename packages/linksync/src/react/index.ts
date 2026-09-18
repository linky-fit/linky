import { Effect } from "effect";
import { useEffect, useMemo, useState } from "react";
import type { CoreSchema, ScopeRegistry, Shard, ShardStore } from "../core";

/**
 * React bindings for the store: a value read whole and re-read after every
 * change its source reports. Repositories are sources; so is a store query
 * paired with the matching subscription.
 */
export interface LiveSource<A> {
  readonly all: Effect.Effect<A>;
  readonly subscribe: (listener: () => void) => () => void;
}

/** The source's current value; `initial` until the first read answers. */
export const useLiveValue = <A>(source: LiveSource<A>, initial: A): A => {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    let latest = 0;
    const read = () => {
      const sequence = ++latest;
      void Effect.runPromise(source.all).then((next) => {
        if (sequence === latest) setValue(next);
      });
    };
    read();
    const unsubscribe = source.subscribe(read);
    return () => {
      latest += 1;
      unsubscribe();
    };
  }, [source]);
  return value;
};

const NO_ROWS: ReadonlyArray<never> = [];

/** A repository's rows, merged across shards and kept current. Empty until the first read answers. */
export const useRepositoryRows = <Row>(
  repository: LiveSource<ReadonlyArray<Row>>,
): ReadonlyArray<Row> => useLiveValue(repository, NO_ROWS);

/** The shards a device reads and syncs for the scope, kept current across rotations here or elsewhere. */
export const useVisibleShards = <
  S extends CoreSchema,
  R extends ScopeRegistry<keyof S & string>,
>(
  store: ShardStore<S, R>,
  scope: keyof R & string,
): ReadonlyArray<Shard> => {
  const source = useMemo(
    () => ({
      all: store.visibleShards(scope),
      subscribe: store.subscribePointers,
    }),
    [store, scope],
  );
  return useLiveValue(source, NO_ROWS);
};
