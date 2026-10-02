# @linky-fit/recurring-payment

Read [`docs/runs.md`](./docs/runs.md) before changing the planner or the transitions: the app's scheduler relies on its run protocol and on each action's patches.

- The planner is pure: everything it needs arrives in `RecurringTickInput`; it never loads or writes.
- The mint keeps a run from being paid twice: a run is named by `recurringEnvelopeKey(orderId, runIndex)`, and only `runPaidPatch` advances `runCount`, written after the money went out. Claims, run statuses and the history are hints: they may decide which device acts and when, never whether a run was paid.
