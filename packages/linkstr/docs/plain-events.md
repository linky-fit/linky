# Plain events

Three verticals publish plain signed events, not gift wraps: anyone can read them, they replace the previous event of their kind on relays, and they are fetched or watched rather than received through the inbox. Every publish signs with the configured identity, goes to every write relay concurrently, and returns a `PlainEventReceipt` with one `RelayPublishResult` per relay. Errors are in [the shared table](./concepts.md#errors).

## Profiles and status

`Profiles` publishes and fetches kind 0 metadata (name, picture, lightning address, …) and kind 30315 status in the `d=general` slot. `ProfileWatch` is the long-lived subscription for a set of pubkeys. Use `Profiles` for one-shot needs (an onboarding publish, contact search, previews) and `ProfileWatch` for everything on screen.

```ts
import { Effect } from "effect";
import {
  ProfileMetadata,
  Profiles,
  StatusDraft,
  type Pubkey,
} from "@linky-fit/linkstr";

const publishThenFetch = (peer: Pubkey) =>
  Effect.gen(function* () {
    const profiles = yield* Profiles;
    yield* profiles.publishProfile(
      new ProfileMetadata({ name: "dave", lud16: "dave@example.com" }),
    );
    yield* profiles.publishStatus(new StatusDraft({ content: "gm" }));
    return yield* profiles.fetchProfile(peer);
  });
```

The result is a `ProfileFetchResult`: `result.profile?.metadata.displayName`, `result.status?.content`, each `null` when the peer has none. Status content is opaque to linkstr; an empty string clears it.

### Wire format

| Event   | Kind  | Tags                                                     | Content                                                                                          |
| ------- | ----- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| profile | 0     | none                                                     | JSON `name`, `display_name`, `picture`, `lud16`, `lud06`, `nip05`, `about`; empty fields omitted |
| status  | 30315 | `["d", "general"]`, `["expiration", expiresAt]` when set | opaque string; empty clears                                                                      |

Decoding kind 0 is tolerant: unknown fields are ignored, non-string values dropped, `displayName` accepted when `display_name` is absent, and `picture` falls back to a legacy `image`. A status whose `d` tag is not `general`, or whose expiration has passed, is dropped.

### Fetching

`fetchProfile(pubkey)` and `fetchProfiles(pubkeys)` return the newest kind 0 and `d=general` status per pubkey, expired statuses excluded, as the same `ProfileUpdated` / `StatusUpdated` facts the watch emits. Fetches and the watch request kind 0 and kind 30315 in separate filters, so a relay that rejects one kind still serves the other. `discoverActiveProfiles(options?)` scans recent activity (kinds 0, 1, 6, 7, 9735 and 30315 within 45 days, 64 authors, unless overridden) and returns the authors' metadata. `searchProfiles(query, options?)` sends a NIP-50 `search` filter to `searchRelays` (the read relays when none are given) and streams ranked hits through `onHits` each time a relay answers, until `deadline` cuts off the slow tail; the returned value is the final ranking.

### Watching

`ProfileWatch.watch(pubkeys, options?)` returns a scoped `Stream<ProfileWatchEvent>` of `ProfileUpdated` and `StatusUpdated` facts; closing the scope tears down the relay subscriptions. Newest wins per `(pubkey, kind)` within the session; older or expired events are dropped and only visible to the inspector as `ProfileEventDropped` ([diagnostics.md](./diagnostics.md)).

```ts
import { Effect, Stream } from "effect";
import { ProfileWatch, type Pubkey } from "@linky-fit/linkstr";

const watchNames = (pubkeys: ReadonlyArray<Pubkey>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const watch = yield* ProfileWatch;
      const facts = yield* watch.watch(pubkeys);
      yield* Stream.runForEach(facts, (event) =>
        Effect.sync(() => {
          if (event._tag === "ProfileUpdated")
            console.log(event.pubkey, event.metadata.name, event.updatedAt);
        }),
      );
    }),
  );
```

Linkstr persists nothing. The watch is newest-wins per session, not per device, so your cache must do its own `updatedAt` comparison. To watch a different set, close the scope and call `watch` again; the React atoms do this for you ([react.md](./react.md#profile-watch)).

### Errors

`NoRelayAcceptedEvent` (publish), `AllRelaysUnreachable` (fetch, search, discover), `NoReadRelaysConfigured` (fetch or watch with no read relays).

## Relay lists

`RelayLists` publishes where you can be reached: the NIP-65 relay list (kind 10002) and the NIP-17 DM inbox relay list (kind 10050), always together as one operation with one receipt per event, and fetches your own current lists so a new device can adopt them.

```ts
import { Effect, Schema } from "effect";
import {
  DEFAULT_NOSTR_RELAYS,
  RelayListEntry,
  RelayLists,
  RelayListsDraft,
  RelayUrl,
} from "@linky-fit/linkstr";

const relays = DEFAULT_NOSTR_RELAYS.filter(Schema.is(RelayUrl));

const publishThenFetch = Effect.gen(function* () {
  const relayLists = yield* RelayLists;
  yield* relayLists.publishRelayLists(
    new RelayListsDraft({
      relays: relays.map(
        (relay) => new RelayListEntry({ relay, marker: null }),
      ),
      dmRelays: relays,
    }),
  );
  return yield* relayLists.fetchOwnRelayLists();
});
```

Both publishes always run to completion; if either was accepted by no relay the operation fails with that event's `NoRelayAcceptedEvent`, and the other may still have landed.

`fetchOwnRelayLists()` queries every read relay and returns `FetchedRelayLists`; a `null` list means no event of that kind was found anywhere. There is no watch: relay lists are read on demand. When adopting fetched lists, prefer kind 10002 and fall back to 10050, and keep the `relaysUpdatedAt` you applied so a relay serving a stale event cannot roll your configuration back.

### Wire format

Two plain replaceable events with empty content: kind 10002 (NIP-65) with one `["r", url]` per relay, or `["r", url, "read" | "write"]` for a one-directional entry, and kind 10050 (NIP-17) with one `["relay", url]` per inbox relay. Decoding drops entries that are not relay urls and turns an unknown marker into `null`.

### Errors

`NoRelayAcceptedEvent` (publish; inspect `kind` and `results`), `AllRelaysUnreachable` (fetch), `NoReadRelaysConfigured`.

## Mute list

`MuteList.publishMuteList(pubkeys)` publishes your NIP-51 mute list: a kind 10000 event with one `p` tag per blocked pubkey, replacing the previous list on relays. There is no draft class; pass the complete list every time, since the newest event is the list. Publish whenever the local block list changes so other clients on the same key honour it.

In React, call `publishMuteListAtom` with the complete pubkey list whenever it changes; it returns the same `PlainEventReceipt`.

```ts
import { Effect } from "effect";
import { MuteList, type Pubkey } from "@linky-fit/linkstr";

const publishBlocked = (blocked: ReadonlyArray<Pubkey>) =>
  Effect.flatMap(MuteList, (muteList) => muteList.publishMuteList(blocked));
```

Publishing does not block anyone by itself, and there is no fetch or watch of your own mute list. Muting is enforced on receive by you: `WrapInbox` still delivers wraps from muted senders, so drop events whose `from` is on your block list in the inbox handler (and check `to` on `Own…Confirmed` facts if you hide a whole conversation).

### Wire format

Kind 10000, plain and replaceable: one `["p", pubkey]` per muted contact, empty content, no encrypted section. Anyone can read the list.

### Errors

`NoRelayAcceptedEvent`; the local block still applies, republish later.
