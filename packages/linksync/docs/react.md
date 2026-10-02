# React

`@linky-fit/linksync/react` binds a component to the store. React is a peer dependency of this entry only; the main entry stays framework-free.

```ts
import {
  useHydrated,
  useRepositoryRows,
  useVisibleShards,
} from "@linky-fit/linksync/react";

const records = useRepositoryRows(transactions); // ReadonlyArray<TransactionRecord>
const shards = useVisibleShards(store, "transactions"); // [{ index, owner }, ...]
const hydrated = useHydrated(store); // false until the store is hydrated
```

`useLiveValue(source, initial)` is the general form: a `LiveSource` is anything with an `all` effect and a `subscribe(listener)` that returns an unsubscribe. Every repository is one, and a store query paired with the matching subscription makes another. Pass a stable source (a memoized repository, or `useMemo` around an ad hoc pair); a new object every render re-subscribes every render.

The hooks do not suspend: the first render shows `initial` (`[]` for the two row hooks, `false` for `useHydrated`) for one round trip to the database. Reads are sequenced, so a slow earlier read cannot overwrite a later one. Scope subscriptions also fire after pointer changes and explicit forgetting, so a mounted chat drops forgotten history without a reload.
