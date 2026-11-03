# Listings

`Listings` shares what a user offers to, or wants from, the people who saved them: a cash intent (has cash and wants bitcoin for it, or the other way round) and listings of goods and services with a price. It is one plain, addressable kind 34133 event per author, so relays keep only the newest and a new reader gets the current state at once, but its content is readable only by the contacts the author chose. It is not public like NIP-99 classified listings (kind 30402) and not a message like a gift wrap: the event is replaced, never backfilled.

## Publishing

`Listings.publish(draft)` signs one event under the configured identity with the whole document and one key slot per recipient, and publishes it to every write relay. Publish the complete document every time; the newest event is the document. Publish again whenever the document or the recipient set changes, including when it becomes empty: `emptyListingsDocument` withdraws everything from everyone still listed, and a recipient left out of `recipients` cannot read the new version at all.

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

A `Listing` has the author's own stable `id` (so a reader can tell an edit from a new entry), a `side` (`offer` or `want`), a trimmed `title` of at most `LISTING_TITLE_MAX_LENGTH` characters, a decimal `amount` with up to two fraction digits as the author typed it, a `currency` (an ISO 4217 code, or `LISTING_SAT_CURRENCY` for whole satoshis) and a `unit` of at most `LISTING_UNIT_MAX_LENGTH` characters saying what the amount buys, in the author's words ("per hour", "per kg"), shown as written. `cash` is `null` when the author has no cash intent.

Publishes of one identity run one at a time and a second publish within the same second is dated one second later, so a relay never keeps an older event over a newer one. It fails with `NoRelayAcceptedEvent` when no write relay accepted the event.

## Watching

`Listings.watch(pubkeys, options?)` returns a scoped `Stream<ListingsUpdated>` for a pubkey set: the stored event of every author on subscribe, then every replacement. Each fact is the author's whole `document` with the event's `updatedAt`. Newest wins per author within the session; closing the scope tears the subscriptions down, and watching a different set means calling `watch` again (the React atoms do this for you, [react.md](./react.md#listings-watch)).

Only an event holding a key slot for the watching identity decodes. An author who never saved the reader has no slot for them, so a reader that watches their own contacts sees exactly the documents of contacts who saved them back; no other check is needed for that, and the author's own event is dropped for the author as well. Linkstr persists nothing: compare `updatedAt` against your cache.

An event that is dropped is only visible to the inspector, as `ListingsEventDropped` inside `ProfileWatchRouted` ([diagnostics.md](./diagnostics.md#inspector)), with one of these reasons:

| Reason               | Meaning                                                                    |
| -------------------- | -------------------------------------------------------------------------- |
| `malformed-event`    | not a signed plain event                                                   |
| `invalid-signature`  | the signature does not verify                                              |
| `unwatched-author`   | a relay answered with an author outside the watched set                    |
| `unsupported-kind`   | a relay answered with another kind                                         |
| `other-d-tag`        | not the `listings` slot                                                    |
| `no-slot`            | no key slot for this identity: the author does not share with it           |
| `undecryptable`      | the slot or the content does not decrypt with the keys derived             |
| `malformed-document` | the decrypted content is not a `ListingsDocument`                          |
| `stale`              | older than, or as old as, the author's event already surfaced this session |

### Errors

`NoRelayAcceptedEvent` (publish), `NoReadRelaysConfigured` (watch with no read relays).

## Wire format

| Kind  | Tags, in order                                                                   | Content                                                                   |
| ----- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 34133 | `d` `listings`, `linky` `listings`, then one `slot` `<id>` `<key>` per recipient | the document JSON, NIP-44 v2 encrypted under a random 32-byte content key |

The event is signed by the author and dated at the real publish time. The `d` tag is constant, so an author has one listings event per relay; publishing replaces it.

Every recipient gets one `slot` tag. Its `<id>` is the first 32 hex characters of `sha256("linky/listings/slot/v1:" ‖ conversationKey)`, and `<key>` is the content key, as 64 hex characters, NIP-44 v2 encrypted under the same `conversationKey`: the NIP-44 conversation key of the author and that recipient (`getConversationKey(authorSecret, recipientPubkey)`, equal from either side). A reader derives the conversation key with the author's pubkey, computes the id, takes the tag that carries it, decrypts the content key and then the content. `listingsSlotId(conversationKey)` is exported for other implementations. Slot order carries no meaning. The author needs no slot: the document is theirs to keep locally.

The content key is drawn fresh for every publish, so a recipient who is no longer listed cannot read any later version, and the content is one NIP-44 v2 payload of the JSON document:

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
      "unit": "per 10 pieces"
    }
  ]
}
```

What relays and anyone else can see: who publishes listings, when, and how many slots the event holds, which is roughly how many contacts the author shares with. Who the slots are for is not derivable without one of the two secret keys, and the content is opaque. This is the deliberate, minimal metadata leak, like the push marker on a gift wrap ([concepts.md](./concepts.md#wire-conventions)).

Relays should treat the kind as any other addressable one (30000–39999 per NIP-01): store it, replace per author and `d` tag, and serve it to `authors` and `#d` filters. It carries no `p` tag on purpose, so a relay cannot be asked for "everything shared with pubkey X".
