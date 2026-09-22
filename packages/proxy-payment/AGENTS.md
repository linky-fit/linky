# @linky/proxy-payment

Usage guides for this package live in `docs/` (index: `docs/README.md`). Read the guide before changing the offer rules; it states the authorization order, the merge precedence and the selector contracts the app's effects rely on.

## Keep the docs in sync

Changing the public surface — anything exported from `src/index.ts` (the offer model, the reducer, selectors, drafts, stagger records, bank QR parsing) — or the behavior a guide describes, is done only when the matching `docs/*.md` file is updated in the same commit. Done means: every snippet in the touched guide still typechecks against the new surface and every table row still names a real field or status.

## Rules

- No React, no Evolu, no `window`/`localStorage`, no i18n. Device state (lease locks, stored bank QR payloads, stagger queues) and user-facing labels stay in the app; the package receives `nowSec` as an argument and never reads a clock.
- Offers are keyed by peer pubkey and offer id, never by contact id or chat row. The app maps pubkeys to contacts at its edge.
- Ids keep linkstr's brands through every public type: `Pubkey` for peers and offerers, `BankOfferId`, `RumorId` for snapshots, `ClientId`. Never widen one to `string`; a caller that has a string validates it into the brand first.
- `@linky/linkstr` is a dependency for the snapshot facts, drafts and receipts only; the package never touches relays. The wire text templates live here because every outgoing draft needs them.
