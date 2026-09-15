# Transactions

`makeTransactionsRepository(store)` (`src/repositories/transactions.ts`) over the `transaction` table in the `transactions` scope, which keeps the newest 4 shards.

`all` returns `TransactionRecord`s, not raw rows: `direction` narrowed to `in | out`, `status` to `ok | pending | error | declined`, and `category` derived from `method` by `deriveTransactionCategory` (`cashu_chat` is `contacts`, the two lightning methods are `lightning`, everything else `cashu`). A row whose direction or status does not validate is skipped until sync completes it. Sorting, request/fulfillment pairing, and the `TransactionItem` view stay in the app's `transactionHistory.ts`.

`insert`, `update`, `remove`, `byId`, and `subscribe` are the plain `TableRepository` methods. There is no `category` or `phase` column to write.
