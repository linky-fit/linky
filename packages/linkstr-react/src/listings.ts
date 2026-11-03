import { Atom } from "effect/reactivity";
import { Listings } from "@linky-fit/linkstr";
import type { ListingsUpdated, Pubkey } from "@linky-fit/linkstr";
import { Effect, Stream } from "effect";
import { linkstrRuntimeAtom } from "./runtime";

/** Pubkeys whose kind 34133 listings to follow; changing the set resubscribes. */
export const watchedListingsAtom = Atom.make<ReadonlyArray<Pubkey>>([]);

/** An object (not a bare function) so setting it never hits the atom
 * setter's updater-form interpretation of function values. */
export interface ListingsWatchHandler {
  readonly onEvent: (event: ListingsUpdated) => void;
}

export const listingsWatchHandlerAtom = Atom.make<ListingsWatchHandler | null>(
  null,
);

/**
 * While mounted (with a handler and a non-empty watched set), runs the
 * listings subscription and feeds every fact through the handler. Changing
 * either atom replaces the subscription without rebuilding the runtime.
 */
export const listingsWatchAtom = linkstrRuntimeAtom.atom((get) => {
  const handler = get(listingsWatchHandlerAtom);
  const pubkeys = get(watchedListingsAtom);
  if (handler === null || pubkeys.length === 0) return Stream.empty;
  return Stream.unwrap(
    Effect.gen(function* () {
      const listings = yield* Listings;
      const facts = yield* listings.watch(pubkeys);
      return Stream.tap(facts, (event) =>
        Effect.sync(() => handler.onEvent(event)),
      );
    }),
  );
});
