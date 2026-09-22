# @linky-fit/recurring-payment

Read [`docs/runs.md`](./docs/runs.md) before changing the planner or the transitions: the app's scheduler relies on its claim protocol and on each action's patches.

- The planner is pure: everything it needs arrives in `RecurringTickInput`; it never loads or writes.
- A run's schedule advances before money moves (`runStartedPatch`) and rolls back only through `runFailedPatch`. Keep that order in any new transition; it stops two passes or two devices from paying one period.
