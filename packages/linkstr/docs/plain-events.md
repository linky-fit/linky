# Plain events

Three verticals publish plain signed events, not gift wraps: anyone can read them, they replace the previous event of their kind on relays, and they are fetched or watched rather than received through the inbox. All publishes sign with the configured identity, go to every write relay concurrently, and return a `PlainEventReceipt` (`eventId`, `kind`, `sentAt`, `results: RelayPublishResult[]` with `relay`, `accepted`, `detail`, and `.accepted` when at least one relay took it). Errors are in [the shared table](./concepts.md#errors).

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

The result is a `ProfileFetchResult`: `result.profile?.metadata.displayName`, `result.status?.content`, each `null` when the peer has none.

### Sending

| Draft             | Fields                                                                                       | Method           |
| ----------------- | -------------------------------------------------------------------------------------------- | ---------------- |
| `ProfileMetadata` | all optional strings: `name`, `displayName`, `picture`, `lud16`, `lud06`, `nip05`, `about`   | `publishProfile` |
| `StatusDraft`     | `content: string` (empty string clears), `expiresAt?: UnixSeconds` (NIP-40 `expiration` tag) | `publishStatus`  |

Status content is opaque to linkstr.

### Wire format

| Event   | Kind  | Tags                                                     | Content                                                                                          |
| ------- | ----- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| profile | 0     | none                                                     | JSON `name`, `display_name`, `picture`, `lud16`, `lud06`, `nip05`, `about`; empty fields omitted |
| status  | 30315 | `["d", "general"]`, `["expiration", expiresAt]` when set | opaque string; empty clears                                                                      |

Decoding kind 0 is tolerant: unknown fields are ignored, non-string values dropped, `displayName` accepted when `display_name` is absent, and `picture` falls back to a legacy `image`. A status whose `d` tag is not `general`, or whose expiration has passed, is dropped.

### Fetching

| Method                             | Returns                                                      | Options                                                                                                               |
| ---------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `fetchProfile(pubkey)`             | `ProfileFetchResult { profile, status }` (each nullable)     |                                                                                                                       |
| `fetchProfiles(pubkeys)`           | `ProfileFetchEntry[]` — `{ pubkey, profile, status }`        | authors are chunked 50 per relay filter                                                                               |
| `discoverActiveProfiles(options?)` | `DiscoveredProfile[]` — `{ pubkey, lastActiveAt, metadata }` | `activityKinds` (default 0, 1, 6, 7, 9735, 30315), `activeWindowSeconds` (45 days), `authorScanLimit` (64)            |
| `searchProfiles(query, options?)`  | `ProfileSearchHit[]` — `{ pubkey, metadata, updatedAt }`     | `limit` (6), `searchRelays` (NIP-50 relays; read relays when empty), `deadline` (2.5 s), `preferredDomains`, `onHits` |

`profile` and `status` are the same `ProfileUpdated` / `StatusUpdated` facts the watch emits: newest event per kind, expired statuses excluded. Search sends the query as typed and, for a last word of three or more characters, once more with a trailing `*` for relays whose full-text index matches whole words; it streams ranked matches through `onHits` each time a relay answers, until the deadline, then interrupts the slow tail. Matching is accent- and case-insensitive on every query word; `preferredDomains` ranks profiles whose `nip05` or `lud16` ends in one of those domains first.

### Watching

`ProfileWatch.watch(pubkeys, options?)` returns a scoped `Stream<ProfileWatchEvent>` (`options.resubscribeDelay`, default 5 s); closing the scope tears down the relay subscriptions. One subscription per relay and 50-author chunk. Newest wins per `(pubkey, kind)` within the session; older or expired events are dropped and only visible to the inspector as `ProfileEventDropped` ([diagnostics.md](./diagnostics.md)).

| Tag              | Fields                                                                                       | Meaning                               |
| ---------------- | -------------------------------------------------------------------------------------------- | ------------------------------------- |
| `ProfileUpdated` | `pubkey: Pubkey`, `metadata: ProfileMetadata`, `updatedAt: UnixSeconds`                      | a newer kind 0 than seen this session |
| `StatusUpdated`  | `pubkey`, `content: string` (empty = cleared), `expiresAt: UnixSeconds \| null`, `updatedAt` | a newer `d=general` kind 30315        |

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

When adopting fetched lists, prefer kind 10002 and fall back to 10050, and keep the `relaysUpdatedAt` you applied so a relay serving a stale event cannot roll your configuration back.

### Sending

| Draft             | Fields                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `RelayListsDraft` | `relays: RelayListEntry[]` (kind 10002), `dmRelays: RelayUrl[]` (kind 10050)                                 |
| `RelayListEntry`  | `relay: RelayUrl`, `marker: "read" \| "write" \| null` — `null` means both, and is written as a bare `r` tag |

`publishRelayLists` returns `RelayListsReceipt { relayList: PlainEventReceipt, dmRelayList: PlainEventReceipt }`. Both publishes always run to completion; if either was accepted by no relay the operation fails with that event's `NoRelayAcceptedEvent`, and the other may still have landed.

### Wire format

Two plain replaceable events with empty content: kind 10002 (NIP-65) with one `["r", url]` per relay, or `["r", url, "read" | "write"]` for a one-directional entry, and kind 10050 (NIP-17) with one `["relay", url]` per inbox relay. Decoding drops entries that are not relay urls and turns an unknown marker into `null`.

### Fetching

`fetchOwnRelayLists()` queries every read relay for your kinds 10002 and 10050 (8 s per relay) and returns `FetchedRelayLists`:

| Field               | Type                       | Note                                  |
| ------------------- | -------------------------- | ------------------------------------- |
| `relays`            | `RelayListEntry[] \| null` | `null` = no kind 10002 found anywhere |
| `relaysUpdatedAt`   | `UnixSeconds \| null`      | `created_at` of that event            |
| `dmRelays`          | `RelayUrl[] \| null`       | `null` = no kind 10050 found          |
| `dmRelaysUpdatedAt` | `UnixSeconds \| null`      |                                       |

There is no watch: relay lists are read on demand.

### Errors

`NoRelayAcceptedEvent` (publish; inspect `kind` and `results`), `AllRelaysUnreachable` (fetch), `NoReadRelaysConfigured`.

## Mute list

`MuteList.publishMuteList(pubkeys)` publishes your NIP-51 mute list: a kind 10000 event with one `p` tag per blocked pubkey, replacing the previous list on relays. There is no draft class; pass the complete list every time, since the newest event is the list. Publish whenever the local block list changes so other clients on the same key honour it.

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

## Related

- [inbox.md](./inbox.md) — where to apply a block
- [identity-and-keys.md](./identity-and-keys.md) — `decodeNpub`, `parsePubkey`
- [diagnostics.md](./diagnostics.md) — relay health for the relays you configured
