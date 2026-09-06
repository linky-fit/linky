# Mute list

`MuteList` publishes your NIP-51 mute list: a kind 10000 event with one `p` tag per blocked pubkey. It is a plain signed event, not gift-wrapped, and replaces the previous list on relays. Publish it whenever the local block list changes so other clients on the same key honour it.

Publishing does not block anyone by itself. Muting is enforced on receive by you, not by linkstr: `WrapInbox` still delivers wraps from muted senders, so check `from` against your block list in the inbox handler (see [Loading and enforcing the list](#loading-and-enforcing-the-list)).

## Quick example

Prerequisites: a `NostrSecretKey`, relay urls, and the `Pubkey`s to block — see [getting-started.md](./getting-started.md).

Headless:

```ts
import { Effect } from "effect";
import {
  MuteList,
  runLinkstr,
  type NostrSecretKey,
  type Pubkey,
  type RelayUrl,
} from "@linky/linkstr";

const publishBlocked = (
  secretKey: NostrSecretKey,
  relays: ReadonlyArray<RelayUrl>,
  blocked: ReadonlyArray<Pubkey>,
) =>
  runLinkstr(
    { secretKey, readRelays: relays, writeRelays: relays },
    Effect.gen(function* () {
      const muteList = yield* MuteList;
      return yield* muteList.publishMuteList(blocked);
    }),
  );
```

The promise resolves with a `PlainEventReceipt`; `receipt.accepted` is true when at least one write relay took the event.

React — block locally first, then publish the whole list. A failed publish keeps the local block and leaves the list to be republished on the next change:

```ts
import { Pubkey } from "@linky/linkstr";
import { publishMuteListAtom, useAtomSet } from "@linky/linkstr-react";
import { Exit, Schema } from "effect";

interface BlockStore {
  // Placeholders for your local storage.
  add: (pubkey: Pubkey) => void;
  all: () => ReadonlyArray<string>;
  markUnpublished: () => void;
}

export const useBlock = (store: BlockStore) => {
  const publishMuteList = useAtomSet(publishMuteListAtom, {
    mode: "promiseExit",
  });

  return async (pubkey: Pubkey): Promise<void> => {
    store.add(pubkey);
    const exit = await publishMuteList(store.all().filter(Schema.is(Pubkey)));
    if (Exit.isFailure(exit)) store.markUnpublished();
  };
};
```

The app keeps the source of truth in local storage and publishes the merged list after each block without waiting on the result; the next block republishes everything anyway.

## Sending

There is no draft class: `publishMuteList(pubkeys: ReadonlyArray<Pubkey>)` takes the complete list. Send everything, not the delta — kind 10000 is replaceable, so the newest event is the list.

`PlainEventReceipt` carries `eventId`, `kind` (10000), `sentAt`, `results: RelayPublishResult[]`, and `.accepted`.

Direct only. The content is empty; muted pubkeys are public `p` tags. Linkstr does not encrypt a private section.

## Loading and enforcing the list

There is no fetch of your own mute list and no watch. Load the list from your own storage (the app treats local storage as authoritative and never reads kind 10000 back) and apply it in the inbox handler:

```ts
import type { Pubkey, WrapInboxEvent } from "@linky/linkstr";

export const dropBlocked =
  (
    isBlocked: (pubkey: Pubkey) => boolean,
    next: (event: WrapInboxEvent) => void,
  ) =>
  (event: WrapInboxEvent): void => {
    if ("from" in event && isBlocked(event.from)) return;
    next(event);
  };
```

Facts about your own sends (`Own*Confirmed`) carry `to` instead of `from`; check that against the list too if you block a conversation entirely, as the app does for bank offers.

## Errors

| Tag                    | When                              | What to do                                     |
| ---------------------- | --------------------------------- | ---------------------------------------------- |
| `NoRelayAcceptedEvent` | no write relay accepted the event | the local block still applies; republish later |
| `LinkstrNotConfigured` | React only, logged out            | keep the local list                            |

## Related

- [inbox.md](./inbox.md) — where to apply the block
- [profiles.md](./profiles.md), [relay-lists.md](./relay-lists.md) — the other plain-event verticals
