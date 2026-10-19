import { isAwaitingFirstHydration } from "@linky-fit/linksync/evolu";
import { Effect, Option } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import { platformAtom } from "../platform";
import { evoluAtom } from "./evolu";
import { linkyStoreAtom } from "./store";

export type Hydration =
  | {
      readonly _tag: "Hydrating";
      /** Owners, the app owner and the visible shards, whose sync round with a relay finished. */
      readonly synced: number;
      /** `null` until the store has read which shards are visible. */
      readonly total: number | null;
    }
  | { readonly _tag: "Hydrated" };

const HYDRATED: Hydration = { _tag: "Hydrated" };

const hydrating = (synced: number, total: number | null): Hydration => ({
  _tag: "Hydrating",
  synced,
  total,
});

/**
 * The account's first hydration on a device that adopted it, counted in
 * owners as their sync rounds finish. Every other launch reads `Hydrated` at
 * once, since a device that hydrated before holds the account's data. It
 * opens the store without waiting for it, so a screen built on it can show
 * before the shards start syncing.
 */
export const hydrationAtom = Atom.keepAlive(
  Atom.make((get): Hydration => {
    const opened = get.once(evoluAtom);
    if (
      opened?.appOwner == null ||
      !isAwaitingFirstHydration(get.once(platformAtom).kv, opened.appOwner.id)
    )
      return HYDRATED;
    const result = get(linkyStoreAtom);
    // A store that failed to open surfaces through the shell instead.
    if (AsyncResult.isFailure(result)) return HYDRATED;
    const store = AsyncResult.isSuccess(result) ? result.value : null;
    const { ownerSync } = opened;

    let hydrated = false;
    const count = () => {
      if (store === null) {
        get.setSelf(hydrating(ownerSync.syncedOwners().size, null));
        return;
      }
      void Effect.runPromise(store.syncOwners()).then((owners) => {
        if (hydrated) return;
        const synced = ownerSync.syncedOwners();
        get.setSelf(
          hydrating(
            owners.filter((owner) => synced.has(owner.id)).length,
            owners.length,
          ),
        );
      });
    };
    get.addFinalizer(ownerSync.subscribe(count));
    if (store !== null) {
      // New pointers make more shards visible, which raises the total.
      get.addFinalizer(store.subscribePointers(count));
      get.addFinalizer(
        store.subscribeHydration(() => {
          hydrated = true;
          get.setSelf(HYDRATED);
        }),
      );
      count();
    }
    return Option.getOrElse(get.self<Hydration>(), () =>
      hydrating(ownerSync.syncedOwners().size, null),
    );
  }),
);
