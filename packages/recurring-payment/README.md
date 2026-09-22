# @linky/recurring-payment

The recurring-payment domain: a saved contact is paid a fixed amount on a schedule from whichever of the user's devices is running. `@linky/linksync` stores the rows; this package owns everything between the stored columns and the UI:

- **Schedule** (`schedule.ts`) — due times as `anchor + n × interval` evaluated as a wall clock in the payment's zone (month-end clamping, DST-safe), the pay-once-and-skip catch-up decision, and how a schedule advances after a run.
- **Amount** (`amount.ts`) — the amount fixed in sats or a fiat unit in hundredths, converted to sats at run time from per-BTC rates.
- **Order** (`order.ts`) — the validated order read from stored columns, run statuses, the claim, the run reference a transaction carries, and whether the history records a run.
- **Planner** (`tick.ts`) — one pass over all orders to at most one action each: `claim`, `run`, `skip`, `waitFunds`, `waitRates` or `markInterrupted`, plus the on-demand run.
- **Transitions** (`transitions.ts`) — the column patch each state change writes: claim, run started/paid/failed/skipped, interrupted-run settlement, pause and resume.
- **Reminders** (`reminders.ts`) — the notice times a reminder server should push for a closed app.

Environment-agnostic: no React, Evolu, browser storage or i18n; `nowSec` is always an argument. Orders carry the shared branded ids from `@linky/domain` (`RecurringPaymentId`, `ContactId`), never plain strings. See [`docs/`](./docs/README.md) for usage and [`AGENTS.md`](./AGENTS.md) for the rules.
