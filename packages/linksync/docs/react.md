# React

`@linky/linksync/react` (`src/react/index.ts`) binds a component to the store. React is a peer dependency of this entry only; the main entry stays framework-free.

```ts
import { useRepositoryRows, useVisibleShards } from "@linky/linksync/react";

const records = useRepositoryRows(transactions); // ReadonlyArray<TransactionRecord>
const shards = useVisibleShards(store, "transactions"); // [{ index, owner }, ...]
```

| Hook                             | Returns                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| `useRepositoryRows(repository)`  | The repository's `all`, re-read after every change it reports; `[]` until the first answer. |
| `useVisibleShards(store, scope)` | `store.visibleShards(scope)`, re-read on every pointer change; `[]` until the first answer. |
| `useLiveValue(source, initial)`  | The general form: any `{ all, subscribe }` pair.                                            |

A `LiveSource` is anything with an `all` effect and a `subscribe(listener)` that returns an unsubscribe: every repository is one, and a store query paired with the matching subscription makes another. Pass a stable source (a memoized repository, or `useMemo` around an ad hoc pair); a new object every render re-subscribes every render. Reads are sequenced, so a slow earlier read cannot overwrite a later one.

The hooks do not suspend. The app resolves the store once before its shell mounts and reads it with `React.use`; the first render of a hook then shows the empty value for one round trip to the database.
