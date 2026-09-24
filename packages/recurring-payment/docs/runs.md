# Runs

## The order

`readRecurringPaymentOrder(columns)` turns stored columns (`RecurringPaymentColumns`, the shape of a linksync `RecurringPaymentRecord`) into a `RecurringPaymentOrder`: the `amount`, the `schedule`, the last run (`lastRunAtSec`, `lastRunStatus`) and the `claim`. It returns `null` for a row this build cannot act on (unknown interval or amount unit), so an older client never misreads a newer row. `id` and `contactId` are the `@linky/domain` brands (`RecurringPaymentId`, `ContactId`), the same types linksync's rows carry.

| `lastRunStatus` | Meaning                                                                            |
| --------------- | ---------------------------------------------------------------------------------- |
| `running`       | a run was started and its schedule already advanced; money may be moving           |
| `paid`          | the last run went out                                                              |
| `failed`        | the last attempt failed; the schedule was rolled back and the planner retries      |
| `skipped`       | the period was given up (no funds by the deadline, unpayable contact, user cancel) |
| `interrupted`   | a `running` mark went stale and was settled by `interruptedRunPatch`               |

## The amount

`RecurringAmount` is `{ amount, unit }` with `unit` `sat` or one of `FIAT_RECURRING_UNITS` (`czk`, `eur`, `chf`, `usd`). A fiat amount is stored in hundredths (`fiatRecurringAmount(150.5, "czk")` is `{ amount: 15050, unit: "czk" }`; `recurringFiatValue` reads it back) and converted at each run: `recurringAmountSat(amount, fiatRates)` takes per-BTC rates (`FiatRatesPerBtc`, which linkshu's `FiatRates` satisfies) and returns `null` while a fiat amount has no rate.

## The planner

`planRecurringPaymentTick(input)` is one scheduler pass. Its input is everything the decision needs — `orders`, `nowSec`, `deviceId`, the spendable `balanceSat`, `fiatRates` and `retryNotBeforeSec` (per order id, set by the app after a failure) — and its output is at most one action per order, ordered by due time so the longest-overdue payment goes first.

| Action            | When                                                                                                                                                                              | The app then                                                                 |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `claim`           | the due time is within `RECURRING_NOTICE_SEC` (60 s) or already past and nobody claimed it; `takeover` when a claim is `RECURRING_CLAIM_TAKEOVER_SEC` (10 min) past its send time | writes `claimPatch` and notifies the user                                    |
| `run`             | this device's claim reached its send time, the amount is known and covered by the balance                                                                                         | writes `runStartedPatch`, pays, then `RUN_PAID_PATCH` or `runFailedPatch`    |
| `skip`            | `insufficientFunds` or `failed` and the next due time has arrived (`recurringSkipDeadlineSec`)                                                                                    | writes `runSkippedPatch`                                                     |
| `waitFunds`       | the balance does not cover the amount and the period is not over                                                                                                                  | tells the user once                                                          |
| `waitRates`       | a fiat amount has no exchange rate                                                                                                                                                | tells the user once                                                          |
| `markInterrupted` | a `running` mark is older than `RECURRING_RUN_STALE_SEC` (15 min)                                                                                                                 | checks the history with `recurringRunRecorded`, writes `interruptedRunPatch` |

The claim protocol: every online device may write a claim, and last-writer-wins sync leaves the same claim everywhere. The send time is the later of the due time and `claim.atSec + RECURRING_NOTICE_SEC`; only the device the claim names runs. `recurringUpcoming(order, nowSec)` exposes the due time, send time and claiming device for the UI.

`runNowAction(order, amountSat, nowSec)` builds the `run` for an on-demand payment: it skips the notice window and consumes the pending period, so the next due time is the first one after whichever is later, now or the pending due time.

```ts
import {
  planRecurringPaymentTick,
  runStartedPatch,
  RUN_PAID_PATCH,
  runFailedPatch,
} from "@linky/recurring-payment";

for (const action of planRecurringPaymentTick({
  orders,
  nowSec,
  deviceId,
  balanceSat,
  fiatRates,
  retryNotBeforeSec,
})) {
  if (action.kind !== "run") continue;
  await write(action.order.id, runStartedPatch(action.advance, nowSec));
  const paid = await pay(action.order, action.amountSat);
  await write(
    action.order.id,
    paid ? RUN_PAID_PATCH : runFailedPatch(action.order),
  );
}
```

## Transitions

Every transition is a `RecurringPaymentPatch`, the plain columns to write; the app brands them for its store. `runStartedPatch` advances the schedule before money moves so no other pass or device pays the same period; `runFailedPatch` is the only rollback. `pausePatch` and `resumePatch` handle pausing; resuming moves a passed due time forward instead of paying it. `CLEAR_CLAIM_PATCH` goes with an edit, which starts a new grid.

## Run references and reminders

A transaction that a run produced carries `recurringRunDetails(run)` in its details (`recurringPaymentId`, `recurringDueAtSec`); `readRecurringRunRef(details)` reads it back and `recurringRunRecorded(transactions, run)` answers whether the history holds a non-error transaction for that due time.

`reminderTimesFor(orders, nowSec)` is the set of times (at most `MAX_SYNCED_REMINDERS`, soonest first) a reminder server should push for a closed app: the notice window before each unpaused next due time.
