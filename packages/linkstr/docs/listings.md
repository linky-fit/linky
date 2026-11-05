# Listings

`Listings` shares what a user offers to, or wants from, the people who saved them: a cash intent (has cash and wants bitcoin for it, or the other way round) and listings of goods and services with a price. It is one plain, addressable kind 34133 event per author (a few, for an author with hundreds of contacts), so relays keep only the newest and a new reader gets the current state at once, but its content is readable only by the contacts the author chose. It is not public like NIP-99 classified listings (kind 30402) and not a message like a gift wrap: the event is replaced, never backfilled.

## Publishing

`Listings.publish(draft)` signs the whole document with one key slot per recipient under the configured identity, and publishes it to every write relay. Publish the complete document every time; the newest publish is the document. Publish again whenever the document or the recipient set changes, including when it becomes empty: `emptyListingsDocument` withdraws everything from everyone still listed, and a recipient left out of `recipients` cannot read the new version and sees it as empty.

```ts
import { Effect } from "effect";
import {
  Listing,
  ListingAmount,
  ListingCurrency,
  Listings,
  ListingsDocument,
  ListingsDraft,
  type Pubkey,
} from "@linky-fit/linkstr";

const share = (contacts: ReadonlyArray<Pubkey>) =>
  Effect.flatMap(Listings, (listings) =>
    listings.publish(
      new ListingsDraft({
        document: new ListingsDocument({
          cash: "offer",
          listings: [
            new Listing({
              id: "eggs",
              side: "offer",
              title: "Eggs from the garden",
              amount: ListingAmount.make("90"),
              currency: ListingCurrency.make("CZK"),
              unit: "per 10 pieces",
            }),
          ],
        }),
        recipients: contacts,
      }),
    ),
  );
```

A `Listing` has the author's own stable `id` (so a reader can tell an edit from a new entry), a `side` (`offer` or `want`), a trimmed `title` of at most `LISTING_TITLE_MAX_LENGTH` characters, a decimal `amount` with up to two fraction digits as the author typed it, a `currency` (an ISO 4217 code, or `LISTING_SAT_CURRENCY` for whole satoshis) and a `unit` of at most `LISTING_UNIT_MAX_LENGTH` characters saying what the amount buys, in the author's words ("per hour", "per kg"), shown as written. A listing may carry one `image`: a `PrivateImage`, the same encrypted Blossom reference an image message carries ([chat.md](./chat.md#images-and-files)), uploaded by the author before publishing. A malformed `image` decodes as none, so the listing and the document still arrive. `cash` is `null` when the author has no cash intent.

The image key goes to every reader of the document and into every copy of the listing they keep or pass on, and it cannot be revoked: removing the image or the reader stops new copies, not the ones already read. A reader whose release does not know `image` drops the field; an author device on such a release republishes the document without the images it does not know about, until a newer device publishes again.

When one event would pass `LISTINGS_MAX_EVENT_BYTES`, the slots are split over several chunk events, each with the whole document; see [Wire format](#wire-format). Publishes of one identity run one at a time and a second publish within the same second is dated one second later, so a relay never keeps an older event over a newer one. It succeeds with one receipt per chunk and fails with `NoRelayAcceptedEvent` when no write relay accepted one of the chunks; publish again then, since the readers of that chunk still see the previous version.

## Watching

`Listings.watch(pubkeys, options?)` returns a scoped `Stream<ListingsUpdated>` for a pubkey set: the stored event of every author on subscribe, then every replacement. Each fact is the author's whole `document` with the event's `updatedAt`. Newest wins per author within the session; closing the scope tears the subscriptions down, and watching a different set means calling `watch` again (the React atoms do this for you, [react.md](./react.md#listings-watch)).

Of a publish split into chunks, only the chunk that would carry the reader's slot counts; the others are dropped as `other-chunk`. That chunk decodes to what the author shares when it holds a key slot for the watching identity. Without one it surfaces as `emptyListingsDocument`: an author who never saved the reader shares nothing with them, and an author who removed the reader withdraws everything from them. So a reader that watches their own contacts sees exactly the documents of contacts who saved them back, and no other check is needed for that. Linkstr persists nothing: compare `updatedAt` against your cache, and replace the cached document with an empty one too.

An event that is dropped is only visible to the inspector, as `ListingsEventDropped` inside `ProfileWatchRouted` ([diagnostics.md](./diagnostics.md#inspector)), with one of these reasons:

| Reason               | Meaning                                                                    |
| -------------------- | -------------------------------------------------------------------------- |
| `malformed-event`    | not a signed plain event                                                   |
| `invalid-signature`  | the signature does not verify                                              |
| `unwatched-author`   | a relay answered with an author outside the watched set                    |
| `unsupported-kind`   | a relay answered with another kind                                         |
| `other-d-tag`        | not a `listings` or `listings:<n>` `d` tag                                 |
| `malformed-chunk`    | the `chunks` tag is not a count, or the `d` tag names a chunk past it      |
| `other-chunk`        | a chunk of the publish that cannot carry the reader's slot                 |
| `undecryptable`      | the slot or the content does not decrypt with the keys derived             |
| `malformed-document` | the decrypted content is not a `ListingsDocument`                          |
| `stale`              | older than, or as old as, the author's event already surfaced this session |

### Errors

`NoRelayAcceptedEvent` (publish), `NoReadRelaysConfigured` (watch with no read relays).

## Wire format

| Kind  | Tags, in order                                                                   | Content                                                                   |
| ----- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 34133 | `d` `listings`, `linky` `listings`, then one `slot` `<id>` `<key>` per recipient | the document JSON, NIP-44 v2 encrypted under a random 32-byte content key |

The event is signed by the author and dated at the real publish time. Below the size cap the `d` tag is always `listings`, so an author has one listings event per relay and publishing replaces it.

An event with every slot would pass the 64 KiB message cap common relays set at about 280 recipients, so a publish whose event would be larger than `LISTINGS_MAX_EVENT_BYTES` (60 000 bytes, counted as the event JSON) is split into `k` chunk events, the fewest that each fit. Chunk `i` has the `d` tag `listings` for `i = 0` and `listings:<i>` otherwise, a `chunks` `<k>` tag after the `linky` tag, and the slots whose `listingsChunkOf(slotId, k)`, the first 8 hex characters of the slot id read as a number modulo `k`, is `i`. Every chunk carries the same content and the same `created_at`, and all `k` are published, empty ones included. A reader takes the chunk its own slot id points to and decides on it alone, so a chunk without the reader's slot means "nothing for you" only when it is the reader's chunk. An event without a `chunks` tag is a publish of one chunk. When `k` shrinks, the higher chunks of the older publish stay on relays; they are older than the new publish, so newest-wins ignores them.

Every recipient gets one `slot` tag. Its `<id>` is the first 32 hex characters of `sha256("linky/listings/slot/v1:" ‖ conversationKey)`, and `<key>` is the content key, as 64 hex characters, NIP-44 v2 encrypted under the same `conversationKey`: the NIP-44 conversation key of the author and that recipient (`getConversationKey(authorSecret, recipientPubkey)`, equal from either side). A reader derives the conversation key with the author's pubkey, computes the id, takes the tag that carries it, decrypts the content key and then the content. `listingsSlotId(conversationKey)` is exported for other implementations. Slot order carries no meaning. The author needs no slot: the document is theirs to keep locally.

The content key is drawn fresh for every publish, so a recipient who is no longer listed cannot read any later version, and the content is one NIP-44 v2 payload of the JSON document, `image` left out when the listing has none:

```json
{
  "cash": "offer" | "want" | null,
  "listings": [
    {
      "id": "eggs",
      "side": "offer" | "want",
      "title": "Eggs from the garden",
      "amount": "90",
      "currency": "CZK" | … | "SAT",
      "unit": "per 10 pieces",
      "image": { "url": "https://…", "key": "…", "nonce": "…", … }
    }
  ]
}
```

What relays and anyone else can see: who publishes listings, when, and how many slots the events hold, which is roughly how many contacts the author shares with. Who the slots are for is not derivable without one of the two secret keys, and the content is opaque. This is the deliberate, minimal metadata leak, like the push marker on a gift wrap ([concepts.md](./concepts.md#wire-conventions)).

Relays should treat the kind as any other addressable one (30000–39999 per NIP-01): store it, replace per author and `d` tag, and serve it to `kinds` and `authors` filters; readers ask for every chunk, so they send no `#d`. It carries no `p` tag on purpose, so a relay cannot be asked for "everything shared with pubkey X".
