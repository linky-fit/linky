# @linky-fit/linkstr

`README.md` and `docs/` ship in the npm tarball and are written for external consumers: API, usage, guarantees. Keep app-specific policy, monorepo paths, issue numbers and change history out of them. Contributor material lives here.

## Keep the docs in sync

Changing the public surface — anything exported from `src/index.ts` or `src/testing/index.ts`, or from `../linkstr-react/src/index.ts` or `../linkstr-react/src/testing/index.ts` — or the behavior a guide describes, is done only when the matching `docs/*.md` is updated in the same commit. Done means: every snippet in the touched guide still typechecks against the new surface, every table row names a real field, event tag, error tag or drop reason, and `docs/README.md`'s kind index and `docs/concepts.md`'s error table still match `src/`. A new vertical gets its own guide (or a section in `docs/payment-kinds.md` / `docs/plain-events.md`) linked from `docs/README.md`.

## Adding a vertical

A vertical is one app-level protocol: drafts and receipts, a wire codec, a send service, inbound facts. Templates: `reactions/` for a two-copy private vertical (peer copy plus own echo), `paymentNotices/` for single-copy with an inbox fact, `paymentTelemetry/` for single-copy without one, `muteList/` for the smallest plain event.

Files under `src/<vertical>/`:

| File        | Holds                                                                                                                                                                         |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain.ts` | drafts (`Schema.Class`, `to: Pubkey` plus optional `clientId` / `sentAt`) and receipts (`Schema.TaggedClass` with `rumorId`, `clientId`, `sentAt`, the `WrapDelivery` copies) |
| `events.ts` | facts (`Schema.TaggedClass`) and their `Schema.Union`: a peer fact with `from`, an own echo with `clientId: NullOr(ClientId)`                                                 |
| `codec.ts`  | kind constants, `encode*Rumor`, `decode*Rumor` returning `Either<Fact, DropReason>`; the only file that knows tags and kinds                                                  |
| `<Name>.ts` | the `Effect.Service` with the operations                                                                                                                                      |

Conventions: name the delivered rumor `rumorId`, never `<thing>Id`; the codec splits own echo from peer fact by comparing `rumor.pubkey` with `me`; build rumors with `rumorWithHash` and read tags with `firstTagValue` / `tagValues` from `internal/nostrEvent.ts`; add new drop reasons to `DropReason` in `inbox/events.ts` instead of reusing a foreign one; Linky-invented kinds continue from 24136 and carry a `["linky", <value>]` marker.

The service uses the shared skeletons so delivery, receipts and inspector emission stay uniform: `sendToPeer(context, "<vertical>.<operation>", draft, { encode, receipt, pushMarkRecipientCopy?, order? })` from `internal/wrapSend.ts` for two-copy sends, `sendToRecipient` for single-copy (fails with `WrapNotDelivered`), `deliverPlainEvent` / `fetchPlainEvents` for plain events. The string name is the inspector operation name.

Registration points:

1. `routeRumor` in `src/inbox/decodeWrapEvent.ts`: add a `case` for the kind; until then it surfaces as `WrapDropped("unsupported-kind")`.
2. `WrapInboxEvent` in `src/inbox/WrapInbox.ts`: add the fact union.
3. `linkstrServices` in `src/composition.ts`: add `X.Default`. For durable sends also extend `OutboxOperation` / `RumorFixedOperation` / `OutboxReceipt` in `outbox/domain.ts` and `normalizeOperation`, `encodeOperationRumor`, `dispatch` and the `Outbox.Default` provide list in `outbox/Outbox.ts`.
4. `src/index.ts`: export domain, events and the service; codec constants only when a consumer needs the kind number.
5. `../linkstr-react/src/<vertical>.ts`: one fn atom per direct operation, re-exported from its `index.ts`. Outbox operations get no atom; they go through `enqueueOutboxAtom`.

Tests to write, copying the reactions ones: `codec.test.ts` (roundtrip, own vs peer split, every drop reason), `<Name>.test.ts` (two wraps, one rumor id, `RecipientNotReached` on partial acceptance), a `WrapInbox.test.ts` case routing a real wrap of the kind, an `inspectorEmission.test.ts` case for the operation name, the react atom test (delivers through the configured transport, fails with `LinkstrNotConfigured`), and outbox tests when queued. Use `src/testing` and `../linkstr-react/src/testing`.

## Inspector emission and the no-key-material rule

No key material in any inspector event, in any field: not an nsec, seed words or `NostrSecretKey`, not an attachment's AES-GCM `key` / `nonce`, not cashu token text. Decrypted message content is acceptable by design.

Sends through `sendToPeer` / `sendToRecipient` and plain operations through `inspectPlainOperation` already emit `OperationSucceeded` / `OperationFailed` / `PlainOperationSucceeded` with `params` passed through `redactInspectorSecrets` (`src/internal/redactInspectorSecrets.ts`), which drops `key` / `nonce` from any object that also carries `encryptionAlgorithm` and replaces a `token` field holding a `cashu…` token with a placeholder. The outbox enqueue row and the inbox routing row apply the same helper. Telemetry emits `{ draft, recipient }`, never the per-attempt signing key. `src/inspector/inspectorEmission.test.ts` asserts none of this leaks; extend it when adding an emission point.

When emitting by hand: build events with `{ disableValidation: true }`, keep the builder lazy inside `inspector.emit(() => …)`, pass drafts, receipts, ids and errors through the helpers above, and never pass the identity service or a config object. For a genuinely new event class follow the repo skill `.agents/skills/adding-inspector-events/`.
