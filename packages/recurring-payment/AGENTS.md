# @linky/recurring-payment

Usage guides for this package live in `docs/` (index: `docs/README.md`). Read the guide before changing the schedule math, the planner or the transitions; it states the catch-up policy, the claim protocol between devices and what each patch must write so no period is paid twice.

## Keep the docs in sync

Changing the public surface — anything exported from `src/index.ts` (the order and amount model, schedule math, the planner and its actions, the transition patches, reminder times) — or the behavior a guide describes, is done only when the matching `docs/*.md` file is updated in the same commit. Done means: every snippet in the touched guide still typechecks against the new surface and every table row still names a real action, status or column.

## Rules

- No React, no Evolu, no `window`/`localStorage`, no i18n. Storage (the linksync repository and its branded columns), timers, notifications, the payment rails and user-facing labels stay in the app; the package receives `nowSec` as an argument and never reads a clock.
- The planner is pure: the same orders, clock, device id, balance and rates give the same actions. Anything it needs to know arrives in `RecurringTickInput`; it never loads or writes.
- A run's schedule is advanced _before_ money moves (`runStartedPatch`) and rolled back only by `runFailedPatch`. Keep that order when adding a transition, it is what stops two passes or two devices from paying one period.
- Ids are the branded types from `@linky/domain` and stay branded through every public type; a run reference read back from JSON is validated into a `RecurringPaymentId`, never left as a string. Do not add a dependency on `@linky/linksync`: the ids are shared through the domain package precisely so this package stays independent of storage.
