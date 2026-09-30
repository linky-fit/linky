# Reactions

`Reactions` adds an emoji to a chat message and takes it back. A reaction is a NIP-25 kind 7 rumor; a retraction is a NIP-09 kind 5 rumor listing the reaction ids. Both are gift-wrapped (kind 1059) to the peer and to yourself. `react` is also an outbox operation (`reaction`); `retract` is direct only.

## Quick example

```ts
import { Effect } from "effect";
import {
  Emoji,
  ReactionDraft,
  Reactions,
  RetractionDraft,
  runLinkstr,
  type NostrSecretKey,
  type Pubkey,
  type RelayUrl,
  type RumorId,
} from "@linky-fit/linkstr";

const reactThenRetract = (
  secretKey: NostrSecretKey,
  relays: ReadonlyArray<RelayUrl>,
  peer: Pubkey,
  messageId: RumorId,
) =>
  runLinkstr(
    { secretKey, readRelays: relays, writeRelays: relays },
    Effect.gen(function* () {
      const reactions = yield* Reactions;
      const reaction = yield* reactions.react(
        new ReactionDraft({
          to: peer,
          target: messageId,
          targetKind: "text",
          targetAuthor: peer,
          emoji: Emoji.make("👍"),
        }),
      );
      return yield* reactions.retract(
        new RetractionDraft({ to: peer, reactionIds: [reaction.rumorId] }),
      );
    }),
  );
```

`react` resolves with a `ReactionReceipt` once a relay accepted the peer's copy; `receipt.rumorId` is the reaction id a retraction refers to. To queue a reaction instead, enqueue `{ _tag: "reaction", draft }` ([outbox.md](./outbox.md)) and read the rumor id from the `EnqueueReceipt`.

## Sending

`ReactionDraft` takes `to`, `target`, `targetKind` (`"text"` | `"image"`), `targetAuthor`, `emoji`, and optional `clientId` / `sentAt`. `RetractionDraft` takes `to`, `reactionIds` (non-empty) and optional `clientId`.

- `target` is the message's rumor id (`ChatMessageReceived.messageId` or the `rumorId` from your own send). `targetKind` becomes the `k` tag (`14` or `15`).
- `to` is always the conversation peer. `targetAuthor` is p-tagged so foreign clients attribute the reaction: the peer for their message, your own pubkey for yours.
- `Emoji` is a non-empty trimmed string of at most 32 characters.
- One reaction per user per message is your policy, not linkstr's: retract the previous reaction before sending a new one if that is what you want.

`ReactionReceipt` and `RetractionReceipt` both carry `rumorId`, `clientId`, `sentAt`, `selfCopy` and `recipientCopy`. Neither wrap is push-marked: reactions never wake a push server.

Retractions are direct because a failed undo is cheap to repeat: remove the local row at once, and if the send fails the next tap sends a fresh retraction.

## Wire format

Two gift wraps, self and peer, never push-marked ([wire conventions](./concepts.md#wire-conventions)).

| Send       | Kind | Tags, in order                                                               | Content   |
| ---------- | ---- | ---------------------------------------------------------------------------- | --------- |
| reaction   | 7    | `p` targetAuthor, `p` to, `p` author, `e` target, `k` `14` or `15`, `client` | the emoji |
| retraction | 5    | `p` to, `p` author, one `e` per retracted reaction id, `client`              | empty     |

The reaction's `e` tag is the target message's rumor id, the same id in both users' inboxes. Decoding requires an `e` tag holding a rumor id, an `Emoji` content, and a `k` tag that is absent, `14` or `15`. A retraction keeps the `e` values that are rumor ids and needs at least one.

## Receiving

| Tag                      | Fields                                                                                          | Meaning                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `ReactionAdded`          | `reactionId: RumorId`, `target: RumorId`, `from: Pubkey`, `emoji: Emoji`, `sentAt: UnixSeconds` | a peer reacted to `target`                       |
| `OwnReactionConfirmed`   | `reactionId`, `target`, `emoji`, `clientId: ClientId \| null`, `sentAt`                         | your reaction echoed (self copy or other device) |
| `ReactionRetracted`      | `reactionIds: NonEmptyArray<RumorId>`, `from: Pubkey`, `sentAt`                                 | a peer removed those reactions                   |
| `OwnRetractionConfirmed` | `retractionId: RumorId`, `reactionIds`, `clientId: ClientId \| null`, `sentAt`                  | your retraction echoed                           |

```ts
import type { Pubkey, RumorId, WrapInboxEvent } from "@linky-fit/linkstr";

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

Two things linkstr leaves to you: a reaction may arrive before its target message (defer it and retry when messages change), and a retraction only applies to reactions authored by the retractor — `ReactionRetracted.from` is the authorship scope.

Drop reasons this codec adds ([the full table](./inbox.md#authentication-and-drop-reasons)): `invalid-reaction` (no `e` tag, a `k` tag other than `14` / `15`, or an invalid emoji) and `invalid-retraction` (no `e` tag that is a rumor id).

## Errors

Direct sends fail with `RecipientNotReached` or `NoRelayReachable`; a queued reaction surfaces only `OutboxJobFailed` on the results stream. See [the error table](./concepts.md#errors).

## Related

- [chat.md](./chat.md) — the messages you react to
- [outbox.md](./outbox.md) — queuing reactions
- [inbox.md](./inbox.md) — where the facts come from
