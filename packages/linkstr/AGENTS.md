# @linky-fit/linkstr

`README.md` and `docs/` ship to npm consumers: API, usage, guarantees. App policy, monorepo paths, issue numbers and change history stay out of them.

## Docs in sync

A change to the public surface (`src/index.ts`, `src/testing/index.ts` and their `../linkstr-react/src/` counterparts) or to behavior a guide describes updates the matching `docs/*.md` in the same commit. In sync means every snippet typechecks, every table row names a real field, event tag, error tag or drop reason, and `docs/README.md`'s kind index and `docs/concepts.md`'s error table match `src/`. A new vertical gets a guide, or a section in `docs/payment-kinds.md` / `docs/plain-events.md`, linked from `docs/README.md`.

## Adding a vertical

Copy the closest template: `reactions/` (peer copy plus own echo), `paymentNotices/` (single copy with an inbox fact), `paymentTelemetry/` (single copy, no fact), `muteList/` (plain event). Send through the shared skeletons (`internal/wrapSend.ts`, `deliverPlainEvent` / `fetchPlainEvents`); they handle delivery, receipts and inspector emission.

- Add the kind to `routeRumor` (`src/inbox/decodeWrapEvent.ts`) and a `WrapInbox.test.ts` case routing a real wrap: an unrouted kind is silently dropped as `unsupported-kind`.
- Register the service in `linkstrServices` (`src/composition.ts`); a durable send also extends `OutboxOperation`.
- Receipts name the delivered rumor `rumorId`; codecs build rumors with `rumorWithHash`.
- A Linky-invented kind takes the next free number above 24136 and carries a `["linky", <value>]` tag.
- linkstr-react gets one fn atom per direct operation; outbox operations go through `enqueueOutboxAtom` instead.

## Inspector events

No key material in any field: nsec, seed words, `NostrSecretKey`, an attachment's AES-GCM `key` / `nonce`, cashu token text. Decrypted message content is fine. The shared skeletons redact through `redactInspectorSecrets`; a hand-built emission passes its drafts, receipts, ids and errors through it, never the identity service or a config object, and adds a case to `src/inspector/inspectorEmission.test.ts`.
