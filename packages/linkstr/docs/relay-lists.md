# Relay lists

`RelayLists` publishes where you can be reached: the NIP-65 relay list (kind 10002) and the NIP-17 DM inbox relay list (kind 10050), always together as one operation with one receipt per event. It also fetches your own current lists so a new device can adopt them. Plain signed events, not gift-wrapped.

## Quick example

Headless:

```ts
import { Effect, Schema } from "effect";
import {
  DEFAULT_NOSTR_RELAYS,
  RelayListEntry,
  RelayLists,
  RelayListsDraft,
  RelayUrl,
  runLinkstr,
} from "@linky/linkstr";

const relays = DEFAULT_NOSTR_RELAYS.filter(Schema.is(RelayUrl));

const lists = await runLinkstr(
  { secretKey, readRelays: relays, writeRelays: relays },
  Effect.gen(function* () {
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
  }),
);
lists.relays?.map((entry) => entry.relay);
```

React:

```ts
import { RelayListEntry, RelayListsDraft } from "@linky/linkstr";
import {
  fetchOwnRelayListsAtom,
  publishRelayListsAtom,
  useAtomSet,
} from "@linky/linkstr-react";
import { Exit } from "effect";

const publishRelayLists = useAtomSet(publishRelayListsAtom, {
  mode: "promiseExit",
});
const fetchOwnRelayLists = useAtomSet(fetchOwnRelayListsAtom, {
  mode: "promiseExit",
});

const published = await publishRelayLists(
  new RelayListsDraft({
    relays: relays.map((relay) => new RelayListEntry({ relay, marker: null })),
    dmRelays: relays,
  }),
);
if (Exit.isFailure(published)) throw new Error("relay list publish failed");

const fetched = await fetchOwnRelayLists();
if (Exit.isSuccess(fetched)) {
  const urls =
    fetched.value.relays?.map((entry) => entry.relay) ??
    fetched.value.dmRelays ??
    [];
  applyRelayUrls(urls);
}
```

The app does this in `useRelayDomain`: it prefers the kind 10002 list, falls back to 10050, and keeps a cached copy keyed by `relaysUpdatedAt` so a relay serving stale events cannot roll the configuration back.

## Sending

| Draft             | Fields                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `RelayListsDraft` | `relays: RelayListEntry[]` (kind 10002), `dmRelays: RelayUrl[]` (kind 10050)                                 |
| `RelayListEntry`  | `relay: RelayUrl`, `marker: "read" \| "write" \| null` — `null` means both, and is written as a bare `r` tag |

| Receipt             | Fields                                                           |
| ------------------- | ---------------------------------------------------------------- |
| `RelayListsReceipt` | `relayList: PlainEventReceipt`, `dmRelayList: PlainEventReceipt` |

Both events are signed with the configured identity and published to every write relay concurrently. Both publishes always run to completion; if either was accepted by no relay the operation fails with that event's `NoRelayAcceptedEvent`, the other may still have landed. Direct only — relay lists are not outbox operations.

`RelayUrl` is a branded `ws://` / `wss://` url with a host. Validate user input with `Schema.is(RelayUrl)` or `Schema.decodeUnknownEither(RelayUrl)`. `DEFAULT_NOSTR_RELAYS` (`defaultRelays.ts`) is a plain string array; filter it through the brand as above before handing it to the config.

## Fetching

`fetchOwnRelayLists()` queries every read relay for your kinds 10002 and 10050 (8 s per relay) and returns `FetchedRelayLists`:

| Field               | Type                       | Note                                  |
| ------------------- | -------------------------- | ------------------------------------- |
| `relays`            | `RelayListEntry[] \| null` | `null` = no kind 10002 found anywhere |
| `relaysUpdatedAt`   | `UnixSeconds \| null`      | `created_at` of that event            |
| `dmRelays`          | `RelayUrl[] \| null`       | `null` = no kind 10050 found          |
| `dmRelaysUpdatedAt` | `UnixSeconds \| null`      |                                       |

Entries whose value is not a relay url are dropped, not rejected. There is no receiving stream: relay lists are read on demand, not watched.

## Errors

| Tag                      | When                                          | What to do                          |
| ------------------------ | --------------------------------------------- | ----------------------------------- |
| `NoRelayAcceptedEvent`   | publish: one of the two events landed nowhere | inspect `kind` and `results`; retry |
| `AllRelaysUnreachable`   | fetch: no read relay answered                 | keep the cached lists               |
| `NoReadRelaysConfigured` | fetch with an empty read-relay set            | seed from `DEFAULT_NOSTR_RELAYS`    |
| `LinkstrNotConfigured`   | React only, logged out                        | do nothing                          |

## Related

- [relay-health.md](./relay-health.md) — status of the relays you configured
- [profiles.md](./profiles.md) — the other plain-event vertical
- [getting-started.md](./getting-started.md) — `readRelays` / `writeRelays` in the config
