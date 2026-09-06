# Profiles

`Profiles` publishes and fetches public profile data: kind 0 metadata (name, picture, lightning address, …) and kind 30315 status in the `d=general` slot. `ProfileWatch` is the long-lived subscription for a set of pubkeys. These are plain signed events — not gift-wrapped — so anyone can read them. Use `Profiles` for one-shot needs (onboarding publish, contact search, previews) and `ProfileWatch` for everything on screen.

## Quick example

Prerequisites: a `NostrSecretKey` and relay urls; fetching also needs the peer's `Pubkey` — see [getting-started.md](./getting-started.md).

Headless:

```ts
import { Effect } from "effect";
import {
  ProfileMetadata,
  Profiles,
  runLinkstr,
  type NostrSecretKey,
  type Pubkey,
  type RelayUrl,
} from "@linky/linkstr";

const publishThenFetch = (
  secretKey: NostrSecretKey,
  relays: ReadonlyArray<RelayUrl>,
  peer: Pubkey,
) =>
  runLinkstr(
    { secretKey, readRelays: relays, writeRelays: relays },
    Effect.gen(function* () {
      const profiles = yield* Profiles;
      yield* profiles.publishProfile(
        new ProfileMetadata({ name: "dave", lud16: "npub1…@linky.fit" }),
      );
      return yield* profiles.fetchProfile(peer);
    }),
  );
```

The result is a `ProfileFetchResult`: `result.profile?.metadata.displayName`, `result.status?.content`, each `null` when the peer has none.

React — a publish handler:

```ts
import { ProfileMetadata, StatusDraft } from "@linky/linkstr";
import {
  publishProfileAtom,
  publishStatusAtom,
  useAtomSet,
} from "@linky/linkstr-react";
import { Exit } from "effect";

export const usePublishProfile = () => {
  const publishProfile = useAtomSet(publishProfileAtom, {
    mode: "promiseExit",
  });
  const publishStatus = useAtomSet(publishStatusAtom, { mode: "promiseExit" });

  return async (name: string, status: string): Promise<boolean> => {
    const profile = await publishProfile(new ProfileMetadata({ name }));
    const statusExit = await publishStatus(
      new StatusDraft({ content: status }),
    );
    return Exit.isSuccess(profile) && Exit.isSuccess(statusExit);
  };
};
```

React — a watch hook that lives as long as the session. `onEvent` is read through a ref so a new callback does not reopen the subscriptions:

```ts
import type { ProfileWatchEvent, Pubkey } from "@linky/linkstr";
import {
  profileWatchAtom,
  profileWatchHandlerAtom,
  useAtomMount,
  useAtomSet,
  watchedProfilesAtom,
} from "@linky/linkstr-react";
import { useEffect, useRef } from "react";

export const useProfileWatch = (
  pubkeys: ReadonlyArray<Pubkey>,
  onEvent: (event: ProfileWatchEvent) => void,
): void => {
  const latest = useRef(onEvent);
  useEffect(() => {
    latest.current = onEvent;
  });
  const setWatched = useAtomSet(watchedProfilesAtom);
  const setHandler = useAtomSet(profileWatchHandlerAtom);
  useAtomMount(profileWatchAtom);
  useEffect(() => {
    setWatched(pubkeys);
    setHandler({ onEvent: (event) => latest.current(event) });
    return () => {
      setHandler(null);
      setWatched([]);
    };
  }, [pubkeys, setHandler, setWatched]);
};
```

Changing `watchedProfilesAtom` resubscribes without rebuilding the runtime. Swapping the handler object also reopens the subscriptions, which is why the hook keeps it stable.

## Sending

| Draft             | Fields                                                                                       | Method           |
| ----------------- | -------------------------------------------------------------------------------------------- | ---------------- |
| `ProfileMetadata` | all optional strings: `name`, `displayName`, `picture`, `lud16`, `lud06`, `nip05`, `about`   | `publishProfile` |
| `StatusDraft`     | `content: string` (empty string clears), `expiresAt?: UnixSeconds` (NIP-40 `expiration` tag) | `publishStatus`  |

Both return a `PlainEventReceipt`: `eventId`, `kind`, `sentAt`, `results: RelayPublishResult[]` (`relay`, `accepted`, `detail`), and `.accepted`. Success means at least one write relay accepted the event.

Wire notes: `displayName` is written as `display_name`; empty strings are omitted. Status content is opaque to linkstr — Linky's conventions (currency list on the last line) live in `apps/web-app/src/nostrStatus.ts`.

## Fetching

| Method                             | Returns                                                      | Options                                                                                                               |
| ---------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `fetchProfile(pubkey)`             | `ProfileFetchResult { profile, status }` (each nullable)     |                                                                                                                       |
| `fetchProfiles(pubkeys)`           | `ProfileFetchEntry[]` — `{ pubkey, profile, status }`        | authors are chunked per relay filter                                                                                  |
| `discoverActiveProfiles(options?)` | `DiscoveredProfile[]` — `{ pubkey, lastActiveAt, metadata }` | `activityKinds` (default 0, 1, 6, 7, 9735, 30315), `activeWindowSeconds` (45 days), `authorScanLimit` (64)            |
| `searchProfiles(query, options?)`  | `ProfileSearchHit[]` — `{ pubkey, metadata, updatedAt }`     | `limit` (6), `searchRelays` (NIP-50 relays; read relays when empty), `deadline` (2.5 s), `preferredDomains`, `onHits` |

`profile` and `status` are the same `ProfileUpdated` / `StatusUpdated` facts the watch emits — newest event per kind, expired statuses excluded. React atoms: `fetchProfileAtom`, `fetchProfilesAtom`, `discoverActiveProfilesAtom`, `searchProfilesAtom` (takes `{ query, options? }`).

Search streams ranked matches through `onHits` each time a relay answers, until the deadline; `preferredDomains` ranks profiles whose `nip05` or `lud16` ends in one of those domains first. Matching is accent- and case-insensitive on every query word.

## Receiving

`ProfileWatch.watch(pubkeys, options?)` returns a scoped `Stream<ProfileWatchEvent>`; closing the scope tears down the relay subscriptions. Newest wins per `(pubkey, kind)` within the session; older or expired events are dropped and only visible to the inspector as `ProfileEventDropped`.

| Tag              | Fields                                                                                       | Meaning                               |
| ---------------- | -------------------------------------------------------------------------------------------- | ------------------------------------- |
| `ProfileUpdated` | `pubkey: Pubkey`, `metadata: ProfileMetadata`, `updatedAt: UnixSeconds`                      | a newer kind 0 than seen this session |
| `StatusUpdated`  | `pubkey`, `content: string` (empty = cleared), `expiresAt: UnixSeconds \| null`, `updatedAt` | a newer `d=general` kind 30315        |

```ts
import type { ProfileWatchEvent, Pubkey, UnixSeconds } from "@linky/linkstr";

/** Placeholder: your cache; compare updatedAt with what you have before overwriting. */
type Save = (pubkey: Pubkey, updatedAt: UnixSeconds, value: string) => void;

export const profileHandler =
  (saveName: Save, saveStatus: Save) =>
  (event: ProfileWatchEvent): void => {
    switch (event._tag) {
      case "ProfileUpdated":
        return saveName(
          event.pubkey,
          event.updatedAt,
          event.metadata.name ?? "",
        );
      case "StatusUpdated":
        return saveStatus(event.pubkey, event.updatedAt, event.content);
    }
  };
```

Linkstr persists nothing. The watch is newest-wins per session, not per device, so your cache must do its own `updatedAt` comparison.

Headless: `ProfileWatch.watch([peer])` inside `Effect.scoped` has the same shape as the inbox example in [getting-started.md](./getting-started.md); it runs until the scope closes.

## Errors

| Tag                      | When                                        | What to do                                              |
| ------------------------ | ------------------------------------------- | ------------------------------------------------------- |
| `NoRelayAcceptedEvent`   | publish: no write relay accepted the event  | show the per-relay `results`; retry                     |
| `AllRelaysUnreachable`   | fetch/search/discover: every relay failed   | keep cached results, show an offline state, retry later |
| `NoReadRelaysConfigured` | fetch or watch with an empty read-relay set | configure relays first                                  |
| `LinkstrNotConfigured`   | React only, logged out                      | read from cache only                                    |

A fetch that reached some relays but not others succeeds with what arrived.

## Related

- [relay-lists.md](./relay-lists.md) — the other plain-event vertical
- [identity-and-keys.md](./identity-and-keys.md) — `decodeNpub`, `parsePubkey`
- [inspector.md](./inspector.md) — seeing `ProfileEventDropped`
