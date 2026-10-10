import { Atom } from "effect/reactivity";
import { ProfileWatch } from "@linky-fit/linkstr";
import type { ProfileWatchEvent, Pubkey } from "@linky-fit/linkstr";
import { Effect, Stream } from "effect";
import { linkstrRuntimeAtom } from "./runtime";

/** Pubkeys whose kind 0/30315 events to follow; changing the set resubscribes. */
export const watchedProfilesAtom = Atom.make<ReadonlyArray<Pubkey>>([]);

/** An object (not a bare function) so setting it never hits the atom
 * setter's updater-form interpretation of function values. */
export interface ProfileWatchHandler {
  readonly onEvent: (event: ProfileWatchEvent) => void;
}

export const profileWatchHandlerAtom = Atom.make<ProfileWatchHandler | null>(
  null,
);

/**
 * While mounted (with a handler and a non-empty watched set), runs the profile
 * subscription and feeds every fact through the handler. Changing either atom
 * replaces the subscription without rebuilding the runtime.
 */
export const profileWatchAtom = linkstrRuntimeAtom.atom((get) => {
  const handler = get(profileWatchHandlerAtom);
  const pubkeys = get(watchedProfilesAtom);
  if (handler === null || pubkeys.length === 0) return Stream.empty;
  return Stream.unwrap(
    Effect.gen(function* () {
      const profileWatch = yield* ProfileWatch;
      const facts = yield* profileWatch.watch(pubkeys);
      return Stream.tap(facts, (event) =>
        Effect.sync(() => handler.onEvent(event)),
      );
    }),
  );
});
