# Runs

## The order

`readRecurringPaymentOrder(columns)` turns stored columns (`RecurringPaymentColumns`, the shape of a linksync `RecurringPaymentRecord`) into a `RecurringPaymentOrder`: the `amount`, the `mintUrl` every run is paid from, the `rail` every run is delivered on, the `schedule`, the last run (`lastRunAtSec`, `lastRunStatus`) and the `claim`. It returns `null` for a row this build cannot act on (unknown rail, interval or amount unit, or a `progress` value that does not decode), so an older client never misreads a newer row. `id` and `contactId` are the `@linky-fit/domain` brands (`RecurringPaymentId`, `ContactId`), the same types linksync's rows carry.

`rail` is `cashu` (the run's token is sent to the contact over Nostr) or `lightning` (the run's envelope is melted to pay the contact's Lightning address). The app picks it once, when the order is created, and every device delivers every run on it, whatever the contact looks like on that device today. Nothing updates `rail` or `mintUrl`; changing either means deleting the order and creating a new one.

`schedule.runCount` is the number of paid runs, so it is also the index of the next run, and `schedule.nextDueAtSec` is the pending due time. Both are stored in one `progress` column, `recurringProgressColumn({ runCount, nextDueAtSec })`, so sync never pairs a count with a due time from another write. Insert a new order with `recurringProgressColumn({ runCount: 0, nextDueAtSec: firstDueAtSec })`. The last run fields are for display; nothing reads them to decide whether money moved.

| `lastRunStatus` | Meaning                                                                            |
| --------------- | ---------------------------------------------------------------------------------- |
| `paid`          | the run's money went out                                                           |
| `failed`        | an attempt failed; the run stays due and is retried until its period ends          |
| `skipped`       | the period was given up (no funds by the deadline, unpayable contact, user cancel) |

## The amount

`RecurringAmount` is `{ amount, unit }` with `unit` `sat` or one of `FIAT_RECURRING_UNITS` (`czk`, `eur`, `chf`, `usd`, `brl`). A fiat amount is stored in hundredths (`fiatRecurringAmount(150.5, "czk")` is `{ amount: 15050, unit: "czk" }`; `recurringFiatValue` reads it back) and converted at each run: `recurringAmountSat(amount, fiatRates)` takes per-BTC rates (`FiatRatesPerBtc`, which linkshu's `FiatRates` satisfies) and returns `null` while a fiat amount has no rate.

## The mint is the arbiter

A run is named by `recurringEnvelopeKey(orderId, runIndex)`, where `runIndex` is the order's `runCount` when the run was planned. The app hands that key to linkshu, which derives the run's envelope (its deterministic outputs) from the wallet seed and the key. Every device and tab that funds the same run asks the order's mint to sign the same outputs, and the mint signs them once, so at most one of them funds the run and the rest adopt the envelope it created. The key names the payment number rather than its due time, so a schedule edit made on a stale device cannot give one payment a second key.

Every attempt, whether from the scheduler or the countdown's pay button, follows the same steps:

1. Open the envelope for `(order.id, action.runIndex)` at `order.mintUrl` with `action.amountSat`. An envelope that already exists keeps the amount its creator chose. When the balance cannot fund a new one (the amount fits but the swap fee does not), handle `unfundedAction(action, nowSec)` like the planner's own `waitFunds` or `skip`. When the contact cannot be paid (no npub on `cashu`, no Lightning address on `lightning`), open nothing: read the state as in step 2, and only an absent or `unspent` envelope skips the period as unpayable.
2. Read its state at the mint. `spent`: the payment went out, write `runPaidPatch`. `pending`: a melt is in flight, do nothing this pass. `unspent`: deliver it on `order.rail` (publish the token to the contact on `cashu`, or melt it for an invoice from the contact's Lightning address on `lightning`; a balance that does not cover the melt's fee reserve is handled like an unfunded open). `mixed`: stop and ask the user to look at it.
3. Once delivered, write `runPaidPatch(action, nowSec)`. A token is delivered when a relay accepted the contact's copy of its message, not when the message was queued or only its copy to self landed: until then the run stays unpaid, and any device that attempts it sends the same token again under the same message id, which the contact's app keeps as one message. A melt is delivered when it paid. On a failure write `runFailedPatch(nowSec)` and set the order's retry time; the envelope stays where it is and the next attempt delivers the same proofs.

Nothing has to be rolled back or recovered by timers. A crash anywhere leaves either no envelope, an envelope still to deliver, or a spent one, and the next device that finds the order due repeats step 1 and continues from what the mint says. When a period ends unpaid it is skipped; `runCount` does not move, so an unspent envelope carries over to the next period, whose run has the same key.

`runPaidPatch` sets `runCount` to `runIndex + 1` instead of incrementing it, so a second device or tab that finishes the same run writes the same row.

Progress can also move back. Every transition writes the count and due time it was computed from, so a late write from a device that had not yet seen a paid run (a skip, an edit or a resume) can win over the paid run's progress and restore the older count. The next run then has the key of the run that was already paid; its envelope is spent, so the run is marked paid without paying again, and the period it was due for goes unpaid. A stale write can cost a period, never pay one twice.

Because the count can move back, an envelope can exist above `runCount`: funded for the next run before a stale write restored the older count. A check of an order's envelopes (on startup, after a wallet restore, after a delete) therefore walks the keys upward from `runCount` to the first one the mint never signed, and settles every envelope it finds on a deleted order. On a live order a spent current run is marked paid right away, before the planner could claim and announce it; the rest follow as the count moves: each spent one is marked paid in turn, and the first unspent one is delivered.

How a deleted order's envelope is settled depends on its rail. On `lightning` nobody has received it, so an unspent one goes back to the balance (linkshu `Envelope.release`). On `cashu` it may already be in the contact's chat, sent by any device, and no device can tell a never-sent envelope from one another device sent; it is the contact's money, so its token is delivered (again) and never released. Deleting a Cashu-rail order whose run is funded therefore still pays that run.

## The planner

`planRecurringPaymentTick(input)` is one scheduler pass. Its input is everything the decision needs: `orders`, `nowSec`, `deviceId`, `balanceSatByMint` (available sats per mint URL), `fiatRates`, `fundedEnvelopeSat` (the sats of each run envelope the app knows the mint signed, by `recurringEnvelopeKey`) and `retryNotBeforeSec` (per order id, set by the app after a failure; no attempt and no funds check before it). Its output is at most one action per order, ordered by due time so the longest-overdue payment goes first.

| Action      | When                                                                                                                                                                              | The app then                                                 |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `claim`     | the due time is within `RECURRING_NOTICE_SEC` (60 s) or already past and nobody claimed it; `takeover` when a claim is `RECURRING_CLAIM_TAKEOVER_SEC` (10 min) past its send time | writes `claimPatch` and notifies the user                    |
| `run`       | this device's claim reached its send time, and the run's envelope is known funded or the amount is known and the balance at `order.mintUrl` covers it                             | follows the steps above and notifies the user of the outcome |
| `skip`      | `insufficientFunds` or `failed` and the next due time has arrived (`recurringSkipDeadlineSec`)                                                                                    | writes `runSkippedPatch` and notifies the user               |
| `waitFunds` | the balance at the order's mint does not cover the amount and the period is not over                                                                                              | asks the user to top up that mint, once per due time         |
| `waitRates` | a fiat amount has no exchange rate and the run's envelope is not known funded                                                                                                     | tells the user once                                          |

The claim decides which device shows the countdown and the notifications, nothing more. Every online device may write one, and last-writer-wins sync leaves the same claim everywhere. The send time is the later of the due time and `claim.atSec + RECURRING_NOTICE_SEC`; only the device the claim names acts, and another device takes over a claim whose device went away. Two devices acting on one run at once is safe, because both open the same envelope. `recurringUpcoming(order, nowSec)` exposes the due time, send time and claiming device for the UI.

A run's envelope holds its funds outside the balance and has its amount fixed, so a run whose key is in `fundedEnvelopeSat` is planned as a `run` with the envelope's amount, whatever the balance and the rates. An envelope funded before a restart or by another device that the app does not know about yet looks like missing funds, though. `waitFunds` and the `insufficientFunds` `skip` (`isRecurringUnfunded(action)`) therefore carry the `run` they would have planned: before waiting or skipping, ask the mint about that run's envelope (linkshu `Envelope.state`, rate-limited per key), and if it exists, follow the steps above with `run` instead. `spent` then counts as paid, `unspent` is delivered, `pending` waits. A run whose envelope exists needs no countdown either: its money was set aside when a device started paying it.

`runNowAction(order, amountSat)` builds the `run` for an on-demand payment: it skips the notice window and pays the pending period, even one not due yet. For a run whose envelope is known funded, pass the envelope's amount; no rate is needed. Its `runPaidPatch` then moves the schedule to the first due time after whichever is later, now or the paid due time.

```ts
import {
  planRecurringPaymentTick,
  recurringEnvelopeKey,
  runFailedPatch,
  runPaidPatch,
} from "@linky-fit/recurring-payment";

for (const action of planRecurringPaymentTick({
  orders,
  nowSec,
  deviceId,
  balanceSatByMint,
  fiatRates,
  fundedEnvelopeSat,
  retryNotBeforeSec,
})) {
  if (action.kind !== "run") continue;
  const key = recurringEnvelopeKey(action.order.id, action.runIndex);
  const delivered = await openAndDeliver(action.order, key, action.amountSat);
  if (delivered === "pending") continue;
  await write(
    action.order.id,
    delivered === "paid"
      ? runPaidPatch(action, nowSec)
      : runFailedPatch(nowSec),
  );
}
```

## Transitions

Every transition is a `RecurringPaymentPatch`, the plain columns to write; the app brands them for its store. A patch that moves the count or the due time writes the whole `progress`.

- `runPaidPatch(run, nowSec)` writes `runCount` `run.runIndex + 1` with the first due time after both now and `run.dueAtSec`.
- `runFailedPatch(nowSec)` only records the attempt; the run stays due.
- `runSkippedPatch({ order, dueAtSec }, nowSec)` moves the due time the same way as a paid run and keeps the order's `runCount`. Skipping a period whose run was already counted (`runCount` moved past its `runIndex`), or whose envelope is already `spent` or `pending`, would leave that payment to count for the next period. So before a user's cancel writes it, compare the count and ask the mint; a counted run needs nothing more, and a spent or pending one is settled as in the steps above instead.
- `pausePatch` and `resumePatch` handle pausing; resuming moves a passed due time forward instead of paying it and keeps the order's `runCount`.
- `editPatch(order, firstDueAtSec)` goes with an edit of the schedule: the due time becomes the new first due time (the new grid's anchor), the order's `runCount` stays and the claim is cleared.

## Run references and reminders

A transaction that a run produced carries `recurringRunDetails(run)` in its details (`recurringPaymentId`, `recurringDueAtSec`), and `readRecurringRunRef(details)` reads it back so the history can link to the payment.

`reminderTimesFor(orders, nowSec)` is the set of times (at most `MAX_SYNCED_REMINDERS`, soonest first) a reminder server should push for a closed app: the notice window before each unpaused next due time.
