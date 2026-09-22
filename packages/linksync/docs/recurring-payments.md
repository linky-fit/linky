# Recurring payments

`makeRecurringPaymentsRepository(store)` (`src/repositories/recurringPayments.ts`) over the `recurringPayment` table in the `transactions` scope, next to the history the payments produce.

`all` returns `RecurringPaymentRecord`s, not raw rows: the columns a scheduler needs to act (`createdAtSec`, `contactId`, `amount`, `unit`, `intervalUnit`, `intervalCount`, `anchorAtSec`, `nextDueAtSec`) are present and non-null, and a row still arriving column by column from sync is skipped until it completes (`normalizeRecurringPayment`). `unit` and `intervalUnit` stay strings here; what values they may take, the schedule math, and the claim protocol between devices belong to `@linky/recurring-payment` (its `readRecurringPaymentOrder` validates a record into an order; see `packages/recurring-payment/docs/`).

`insert`, `update`, `remove`, `byId`, and `subscribe` are the plain `TableRepository` methods; every write ends with `maybeRotate` of the `transactions` scope, so a payment written after a rotation lands in the active shard like a transaction would, and an update of a payment living in an older shard copies it forward (see [core](./core.md#rotation-in-detail)).

```ts
import { Effect } from "effect";
import {
  createId,
  makeRecurringPaymentsRepository,
  NonEmptyString100,
  NonNegativeInt,
  PositiveInt,
} from "@linky/linksync";

const payments = makeRecurringPaymentsRepository(store);

await Effect.runPromise(
  payments.insert({
    id: createId<"RecurringPayment">(),
    createdAtSec: PositiveInt.orThrow(nowSec),
    contactId,
    amount: PositiveInt.orThrow(15_000), // 150.00 CZK in hundredths
    unit: NonEmptyString100.orThrow("czk"),
    intervalUnit: NonEmptyString100.orThrow("month"),
    intervalCount: PositiveInt.orThrow(1),
    anchorAtSec: PositiveInt.orThrow(firstDueAtSec),
    timeZone: NonEmptyString100.orThrow("Europe/Prague"),
    nextDueAtSec: PositiveInt.orThrow(firstDueAtSec),
    runCount: NonNegativeInt.orThrow(0),
  }),
);
```

In the app, `useRepositoryRows(repository)` from [`@linky/linksync/react`](./react.md) keeps a component on the current records.
