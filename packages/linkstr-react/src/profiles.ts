import { Atom } from "@effect-atom/atom-react";
import { Profiles, ProfileWatch } from "@linky/linkstr";
import type {
  DiscoverActiveProfilesOptions,
  ProfileMetadata,
  ProfileWatchEvent,
  Pubkey,
  SearchProfilesOptions,
  StatusDraft,
} from "@linky/linkstr";
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
  return Stream.unwrapScoped(
    Effect.gen(function* () {
      const profileWatch = yield* ProfileWatch;
      const facts = yield* profileWatch.watch(pubkeys);
      return Stream.tap(facts, (event) =>
        Effect.sync(() => handler.onEvent(event)),
      );
    }),
  );
});

export const fetchProfileAtom = linkstrRuntimeAtom.fn<Pubkey>()((pubkey) =>
  Effect.flatMap(Profiles, (profiles) => profiles.fetchProfile(pubkey)),
);

export const createFetchProfilesAtom = () =>
  linkstrRuntimeAtom.fn<ReadonlyArray<Pubkey>>()((pubkeys) =>
    Effect.flatMap(Profiles, (profiles) => profiles.fetchProfiles(pubkeys)),
  );

export const fetchProfilesAtom = createFetchProfilesAtom();

export const discoverActiveProfilesAtom = linkstrRuntimeAtom.fn<
  DiscoverActiveProfilesOptions | undefined
>()((options) =>
  Effect.flatMap(Profiles, (profiles) =>
    profiles.discoverActiveProfiles(options),
  ),
);

export const searchProfilesAtom = linkstrRuntimeAtom.fn<{
  readonly query: string;
  readonly options?: SearchProfilesOptions;
}>()(({ query, options }) =>
  Effect.flatMap(Profiles, (profiles) =>
    profiles.searchProfiles(query, options),
  ),
);

export const publishProfileAtom = linkstrRuntimeAtom.fn<ProfileMetadata>()(
  (metadata) =>
    Effect.flatMap(Profiles, (profiles) => profiles.publishProfile(metadata)),
);

export const publishStatusAtom = linkstrRuntimeAtom.fn<StatusDraft>()((draft) =>
  Effect.flatMap(Profiles, (profiles) => profiles.publishStatus(draft)),
);
