# @linky-fit/recurring-payment

The recurring-payment domain: a saved contact is paid a fixed amount on a schedule from whichever of the user's devices is running. `@linky-fit/linksync` stores the rows; this package owns everything between the stored columns and the UI:

- **Schedule** (`schedule.ts`) — due times as `anchor + n × interval` evaluated as a wall clock in the payment's zone (month-end clamping, DST-safe), and the pay-once-and-skip catch-up decision.
- **Amount** (`amount.ts`) — the amount fixed in sats or a fiat unit in hundredths, converted to sats at run time from per-BTC rates.
- **Order** (`order.ts`) — the validated order read from stored columns (with the mint every run is paid from, the rail every run is delivered on, and the progress that stores the run count with the due time), run statuses, the claim, the envelope key that names a run at the mint, and the run reference a transaction carries.
- **Planner** (`tick.ts`) — one pass over all orders to at most one action each: `claim`, `run`, `skip`, `waitFunds` or `waitRates`, plus the on-demand run.
- **Transitions** (`transitions.ts`) — the column patch each state change writes: claim, run paid/failed/skipped, pause, resume and edit.
- **Reminders** (`reminders.ts`) — the notice times a reminder server should push for a closed app.

Environment-agnostic: no React, Evolu, browser storage or i18n; `nowSec` is always an argument. Orders carry the shared branded ids from `@linky-fit/domain` (`RecurringPaymentId`, `ContactId`), never plain strings. See [`docs/`](./docs/README.md) for usage and [`AGENTS.md`](./AGENTS.md) for the rules.
