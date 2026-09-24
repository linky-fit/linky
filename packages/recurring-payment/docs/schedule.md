# Schedule

`RecurringScheduleState` is what the schedule math needs from an order: the anchor (`anchorAtSec`, the first due time), the `interval` (`{ unit, count }` with `unit` one of `hour`, `day`, `week`, `month`), the IANA `timeZone` the order was created in (`null` when unknown), the pending `nextDueAtSec`, `runCount` and `pausedAtSec`.

## Due times

Due times are `anchor + n × interval`, never "last run + interval". For `day`, `week` and `month` the step is applied to the anchor's wall clock in the order's zone and converted back to an instant, so:

- a monthly payment anchored on Jan 31 pays on Feb 28, Mar 31, Apr 30 instead of drifting earlier;
- daily and weekly payments keep their wall-clock time across DST changes; a wall clock inside a DST gap resolves to just after the gap, an ambiguous one to the offset in force after the transition;
- hourly payments add whole hours to the instant.

```ts
import {
  nextRecurringOccurrenceAfter,
  recurringDueAt,
  resolveTimeZone,
} from "@linky/recurring-payment";

const zone = resolveTimeZone(order.schedule.timeZone); // the device zone when unknown
recurringDueAt(anchorAtSec, { unit: "month", count: 1 }, 3, zone); // 3 months after the anchor
nextRecurringOccurrenceAfter(anchorAtSec, interval, nowSec, zone); // { occurrence, dueAtSec }
nextDueAfter(order.schedule, nowSec); // the same, straight from a schedule
```

`isValidRecurringInterval` enforces the floor of one hour (`MIN_RECURRING_INTERVAL_SEC`) and the cap of `MAX_RECURRING_INTERVAL_COUNT` (999) on `count`.

## Catch-up: pay once and skip

`decideRecurringRun(schedule, nowSec)` returns `paused`, `wait` (with `untilSec`) or `due` (with `dueAtSec` and `missedCount`). A payment is due as soon as `nowSec ≥ nextDueAtSec` however many due times passed while the app was closed; `missedCount` says how many were skipped so the run can say so. `pausedAtSec` wins over everything.

`advanceRecurringSchedule(schedule, nowSec)` is the state after a run settled: `nextDueAtSec` becomes the first due time strictly after now, so missed periods are never paid retroactively, and `runCount` grows by one.
