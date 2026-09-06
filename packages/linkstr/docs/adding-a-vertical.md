# Adding a vertical

A vertical is one app-level protocol: its drafts and receipts, its wire codec, its send service, and its inbound facts. This is the checklist for adding one; read it before touching `WrapInbox` or `linkstrServices`.

It assumes a **two-copy private vertical**: a gift-wrapped rumor sent to the peer and echoed to yourself, received through `WrapInbox`, with `reactions/` as the template. For the other shapes, copy a different template and skip the inbox steps that do not apply:

- Single-copy private (no self copy, no own echo): `paymentNotices/` (`sendToRecipient`, has an inbox fact) or `paymentTelemetry/` (no inbox fact at all).
- Plain public event (signed, published as-is, fetched or watched): `muteList/` is the smallest.

## The four files

Create `packages/linkstr/src/<vertical>/`:

| File        | Holds                                                                                   | Reactions example                                              |
| ----------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `domain.ts` | drafts (`Schema.Class`) and receipts (`Schema.TaggedClass`); brands for field types     | `ReactionDraft`, `RetractionDraft`, `ReactionReceipt`, `Emoji` |
| `events.ts` | inbound facts (`Schema.TaggedClass`) and their `Schema.Union`                           | `ReactionAdded`, `OwnReactionConfirmed`, `ReactionInboxEvent`  |
| `codec.ts`  | kind constants, `encode*Rumor`, `decode*Rumor`; the only file that knows tags and kinds | `REACTION_KIND`, `encodeReactionRumor`, `decodeReactionRumor`  |
| `<Name>.ts` | the `Effect.Service` with the operations                                                | `Reactions` with `react`, `retract`                            |

Conventions to keep:

- Drafts take `to: Pubkey` plus optional `clientId` and `sentAt`; receipts carry `rumorId`, `clientId`, `sentAt`, and the `WrapDelivery` copies. Name the delivered rumor `rumorId`, never `<thing>Id`.
- Facts come in pairs: a peer fact with `from` and an own echo with `clientId: NullOr(ClientId)`. The codec decides by comparing `rumor.pubkey` with `me`.
- `decode*Rumor` returns `Either<Fact, DropReason>`. Add your reason(s) to `DropReason` in `inbox/events.ts` (`"invalid-reaction"` is the pattern) rather than reusing a foreign one.
- Build rumors with `rumorWithHash` from `internal/nostrEvent.ts`; read tags with `firstTagValue` / `tagValues`.

## The service

Use the shared send skeleton so delivery, receipts, and inspector emission stay uniform:

```ts
import { Effect } from "effect";
import type { NoRelayReachable, RecipientNotReached } from "../domain/errors";
import { makeWrapSendContext, sendToPeer } from "../internal/wrapSend";
import { encodeReactionRumor } from "./codec";
import { ReactionReceipt, type ReactionDraft } from "./domain";

export class Reactions extends Effect.Service<Reactions>()(
  "linkstr/Reactions",
  {
    effect: Effect.gen(function* () {
      const context = yield* makeWrapSendContext;
      const react = (
        draft: ReactionDraft,
      ): Effect.Effect<
        ReactionReceipt,
        RecipientNotReached | NoRelayReachable
      > =>
        sendToPeer(context, "reactions.react", draft, {
          encode: encodeReactionRumor,
          receipt: (outcome) => new ReactionReceipt(outcome),
        });
      return { react } as const;
    }),
  },
) {}
```

- `sendToPeer` is the two-copy NIP-17 send. Options: `pushMarkRecipientCopy` (chat text and images set it) and `order: "recipientFirst"` (bank offers, when the self copy must never outrun the peer copy).
- `sendToRecipient` is the single-copy variant (payment notices, telemetry); it fails with `WrapNotDelivered`.
- The string name (`"reactions.react"`) is the inspector operation name; keep it `<vertical>.<operation>`.
- Plain-event verticals use `deliverPlainEvent` from `internal/plainDelivery.ts` and `fetchPlainEvents` from `internal/plainFetch.ts` instead; look at `muteList/MuteList.ts` for the smallest example.

## Register it

1. **Inbox dispatch** — `inbox/decodeWrapEvent.ts`, `routeRumor`: add a `case` for your kind that calls your `decode*Rumor` and wraps a `Left` in `WrapDropped`. This is the single dispatch point; until you add it, your kind surfaces as `WrapDropped("unsupported-kind")`.
2. **Union** — `inbox/WrapInbox.ts`: add your `XInboxEvent` to `WrapInboxEvent`.
3. **Composition** — `composition.ts`: add `X.Default` to `linkstrServices`. If sends must be durable, add an operation tag to `outbox/domain.ts` (`OutboxOperation`, `RumorFixedOperation`, `OutboxReceipt`), extend `normalizeOperation`, `encodeOperationRumor`, and `dispatch` in `outbox/Outbox.ts`, and list `X.Default` in the `Outbox.Default` provide list.
4. **Exports** — `index.ts`: export `domain`, `events`, and the service; export codec constants only if a consumer needs the kind number.
5. **React** — `packages/linkstr-react/src/<vertical>.ts`: one fn atom per **direct** operation, then `export * from "./<vertical>"` in `index.ts`. Operations that go through the outbox get no atom of their own: the app enqueues them with the existing `enqueueOutboxAtom` and observes them through `useOutboxResults` ([react.md](./react.md#outbox)), which is why there is a `retractReactionAtom` but no `reactAtom`.

```ts
import { Reactions } from "@linky/linkstr";
import type { RetractionDraft } from "@linky/linkstr";
import { Effect } from "effect";
import { linkstrRuntimeAtom } from "./runtime";

export const retractReactionAtom = linkstrRuntimeAtom.fn<RetractionDraft>()(
  (draft) => Effect.flatMap(Reactions, (reactions) => reactions.retract(draft)),
);
```

## Tests to write

| Test                                           | Pattern to copy                                | What it proves                                                                              |
| ---------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `codec.test.ts`                                | `reactions/codec.test.ts`                      | encode → decode roundtrips; own vs peer split; every drop reason                            |
| `<Name>.test.ts`                               | `reactions/Reactions.test.ts`                  | two wraps published, same rumor id, `RecipientNotReached` on partial acceptance             |
| `inbox/WrapInbox.test.ts` addition             | the `chatWrap` / `paymentNoticeWrap` helpers   | a real wrap of your kind routes to your fact                                                |
| `inspector/inspectorEmission.test.ts` addition | existing cases                                 | `OperationSucceeded` carries your operation name                                            |
| `linkstr-react/src/<vertical>.test.ts`         | `reactions.test.ts`                            | the fn atom delivers through the configured transport and fails with `LinkstrNotConfigured` |
| Outbox tests, if queued                        | `outbox/Outbox.test.ts`, `OutboxStore.test.ts` | stored job decodes; the result carries your receipt                                         |

Use `@linky/linkstr/testing` and `linkstr-react/src/testing` ([testing.md](./testing.md)).

## Inspector events to emit

Sends through `sendToPeer` / `sendToRecipient` already emit `OperationSucceeded` / `OperationFailed`, inbox routing already emits `InboxRouted`. You only add emission for a genuinely new kind of fact, and then you follow `.agents/skills/adding-inspector-events/`. On the app side, add the new operation name and tags to the inspector glossary so the timeline explains them.

## Documentation

Add `docs/<vertical>.md` next to the other vertical guides and, in the same commit, list it in the guide index [`docs/README.md`](./README.md), the vertical list in the [package README](../README.md), and the "Linkstr protocol package" section of the repo's `docs/architecture.md`.

## Related

- [concepts.md](./concepts.md)
- [inbox.md](./inbox.md), [outbox.md](./outbox.md)
- [reactions.md](./reactions.md) — the reference vertical's guide
- [inspector.md](./inspector.md)
