# Reactions

`Reactions` adds an emoji to a chat message and takes it back. A reaction is a NIP-25 kind 7 rumor; a retraction is a NIP-09 kind 5 rumor listing the reaction ids. Both are gift-wrapped (kind 1059) to the peer and to yourself. In the app, `react` goes through the outbox and `retract` sends direct.

## Quick example

Prerequisites: a `NostrSecretKey`, relay urls, the peer's `Pubkey`, and the `RumorId` of a message you received — see [getting-started.md](./getting-started.md) and [chat.md](./chat.md).

Headless:

```ts
import { Effect } from "effect";
import {
  Emoji,
  ReactionDraft,
  Reactions,
  runLinkstr,
  type NostrSecretKey,
  type Pubkey,
  type RelayUrl,
  type RumorId,
} from "@linky/linkstr";

const react = (
  secretKey: NostrSecretKey,
  relays: ReadonlyArray<RelayUrl>,
  peer: Pubkey,
  messageId: RumorId,
) =>
  runLinkstr(
    { secretKey, readRelays: relays, writeRelays: relays },
    Effect.gen(function* () {
      const reactions = yield* Reactions;
      return yield* reactions.react(
        new ReactionDraft({
          to: peer,
          target: messageId,
          targetKind: "text",
          targetAuthor: peer,
          emoji: Emoji.make("👍"),
        }),
      );
    }),
  );
```

The promise resolves with a `ReactionReceipt` once a relay accepted the peer's copy; `receipt.rumorId` is the reaction id a retraction refers to.

React — the app's split: react through the outbox, retract directly. `ReactionStore` stands in for your own persistence; the rumor id saved after enqueue is what you read back to retract:

```ts
import {
  ClientId,
  OutboxRef,
  ReactionDraft,
  RetractionDraft,
  type Emoji,
  type Pubkey,
  type RumorId,
} from "@linky/linkstr";
import {
  enqueueOutboxAtom,
  retractReactionAtom,
  useAtomSet,
} from "@linky/linkstr-react";
import { Exit } from "effect";

interface ReactionStore {
  // Placeholders for your persistence layer, keyed by your local row id.
  insertPending: (target: RumorId, emoji: Emoji, clientId: ClientId) => string;
  saveRumorId: (localRowId: string, rumorId: RumorId) => void;
  takeRumorId: (localRowId: string) => RumorId | null; // reads it back and removes the row
}

export const useReactions = (store: ReactionStore) => {
  const enqueueOutbox = useAtomSet(enqueueOutboxAtom, { mode: "promiseExit" });
  const retract = useAtomSet(retractReactionAtom, { mode: "promiseExit" });

  const react = async (peer: Pubkey, target: RumorId, emoji: Emoji) => {
    const clientId = ClientId.make(crypto.randomUUID());
    const localRowId = store.insertPending(target, emoji, clientId);
    const draft = new ReactionDraft({
      to: peer,
      target,
      targetKind: "text",
      targetAuthor: peer,
      emoji,
      clientId,
    });
    const enqueued = await enqueueOutbox({
      op: { _tag: "reaction", draft },
      ref: OutboxRef.make(`reaction:${localRowId}`),
    });
    if (Exit.isSuccess(enqueued))
      store.saveRumorId(localRowId, enqueued.value.rumorId);
  };

  const unreact = async (peer: Pubkey, localRowId: string) => {
    const reactionId = store.takeRumorId(localRowId);
    if (reactionId === null) return false;
    const retracted = await retract(
      new RetractionDraft({ to: peer, reactionIds: [reactionId] }),
    );
    // A failed direct send queues nothing: offer a retry, or the peer keeps the reaction.
    return Exit.isSuccess(retracted);
  };

  return { react, unreact };
};
```

Enqueue success only means the job is persisted and `rumorId` is fixed. Relay acceptance arrives later on the outbox results stream as a `ReactionReceipt` keyed by your `ref` ([outbox.md](./outbox.md)).

## Sending

`ReactionDraft` takes `to`, `target`, `targetKind` (`"text"` | `"image"`), `targetAuthor`, `emoji`, and optional `clientId` / `sentAt`. `RetractionDraft` takes `to`, `reactionIds` (non-empty), and optional `clientId`.

- `target` is the message's rumor id (`ChatMessageReceived.messageId` or the `rumorId` from your own send). `targetKind` becomes the `k` tag (`14` or `15`).
- `to` is always the conversation peer. `targetAuthor` is p-tagged so foreign clients attribute the reaction: the peer for their message, your own pubkey for yours.
- `Emoji` is a non-empty trimmed string of at most 32 characters.
- One reaction per user per message is app policy, not linkstr's: the app retracts its previous reaction before sending a new one.

`ReactionReceipt` and `RetractionReceipt` both carry `rumorId`, `clientId`, `sentAt`, `selfCopy: WrapDelivery`, and `recipientCopy: WrapDelivery`. Neither wrap is push-marked: reactions never wake the push server.

Direct vs outbox: `Reactions.react` is available directly, but the app enqueues it (`{ _tag: "reaction", draft }`) so a reaction tapped offline is delivered later. Retractions stay direct: the app removes the local row immediately, and when the send fails nothing is queued — the user's next tap sends a fresh retraction.

## Receiving

| Tag                      | Fields                                                                                          | Meaning                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `ReactionAdded`          | `reactionId: RumorId`, `target: RumorId`, `from: Pubkey`, `emoji: Emoji`, `sentAt: UnixSeconds` | a peer reacted to `target`                       |
| `OwnReactionConfirmed`   | `reactionId`, `target`, `emoji`, `clientId: ClientId \| null`, `sentAt`                         | your reaction echoed (self copy or other device) |
| `ReactionRetracted`      | `reactionIds: NonEmptyArray<RumorId>`, `from: Pubkey`, `sentAt`                                 | a peer removed those reactions                   |
| `OwnRetractionConfirmed` | `retractionId: RumorId`, `reactionIds`, `clientId: ClientId \| null`, `sentAt`                  | your retraction echoed                           |

```ts
import type { Pubkey, RumorId, WrapInboxEvent } from "@linky/linkstr";

interface ReactionStore {
  // Placeholders for your persistence layer.
  upsert: (id: RumorId, target: RumorId, from: Pubkey, emoji: string) => void;
  confirm: (clientIdOrReactionId: string) => void;
  remove: (ids: ReadonlyArray<RumorId>, author: Pubkey) => void;
}

export const reactionHandler =
  (store: ReactionStore, me: Pubkey) =>
  (event: WrapInboxEvent): void => {
    switch (event._tag) {
      case "ReactionAdded":
        return store.upsert(
          event.reactionId,
          event.target,
          event.from,
          event.emoji,
        );
      case "OwnReactionConfirmed":
        return store.confirm(event.clientId ?? event.reactionId);
      case "ReactionRetracted":
        return store.remove(event.reactionIds, event.from);
      case "OwnRetractionConfirmed":
        return store.remove(event.reactionIds, me);
      default:
        return;
    }
  };
```

Two things the app handles that linkstr leaves to you: a reaction may arrive before its target message (the app defers it and retries when messages change), and a retraction only applies to reactions authored by the retractor — `ReactionRetracted.from` is the authorship scope.

Drop reasons: `invalid-reaction` (no `e` tag, a `k` tag other than `14`/`15`, or an invalid emoji) and `invalid-retraction` (no `e` tag that is a rumor id). A kind 5 with a mix of rumor ids and foreign ids keeps the rumor ids.

## Errors

| Tag                    | When                                                 | What to do                                     |
| ---------------------- | ---------------------------------------------------- | ---------------------------------------------- |
| `RecipientNotReached`  | self copy accepted, peer's copy accepted by no relay | retry; through the outbox this happens for you |
| `NoRelayReachable`     | no relay accepted anything                           | offline; retry later                           |
| `OutboxJobFailed`      | `identity-changed` or `unexpected-error` terminal    | mark the local row failed                      |
| `LinkstrNotConfigured` | React only, logged out                               | do not send                                    |

## Related

- [chat.md](./chat.md) — the messages you react to
- [outbox.md](./outbox.md) — `enqueueOutboxAtom`, results, refs
- [inbox.md](./inbox.md) — where the facts come from
- [adding-a-vertical.md](./adding-a-vertical.md) — this is the reference vertical the template is based on
