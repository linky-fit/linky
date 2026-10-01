# Concepts

What goes into a linkshu call, what comes out, how proofs and operations move, how failures are classified, and how an interrupted operation is finished. The other guides link here instead of repeating it.

## Drafts in, receipts out

Every operation takes a draft (`ReceiveDraft`, `SendDraft`, `MeltDraft`, `TopupDraft`, …) and returns a receipt or report (`ReceiveReceipt`, `SendReceipt`, `MeltReceipt`, `ValidationReport`, …). Both are `Schema.Class` values over branded primitives. The currency of the API is token text (`cashuA…`/`cashuB…`), never proof lists.

A receipt resolves only after the funds it describes are persisted. Change, remainders, and recovered proofs are `available` in the inventory before you see it.

## Branded primitives

Each primitive is an effect `Schema` with a brand, so a plain `string` or `number` does not type-check where one is expected. The constraints the declarations do not show: `MintUrl` is an http(s) url with a host and no trailing slash (build it with `parseMintUrl(raw)`, which trims and strips slashes and returns `MintUrl | null`; two spellings of one mint would fork its counters); `TokenText` starts with `cashu`; `Bolt11Invoice` starts with `ln`; `Amount` is a positive integer and `NonNegativeAmount` allows zero; `KeysetId` is even-length hex; `Bip39Seed` is exactly 64 bytes. `X.make(value)` throws on invalid input, `Schema.decodeUnknownOption(X)(value)` returns an `Option`, and `Schema.decodeUnknownSync(SendDraft)(plainObject)` decodes a whole draft at once.

## Proofs and operations

The wallet is an inventory. The `ProofStore` holds one `StoredProof` per proof; the `OperationStore` holds one `StoredOperation` per operation. The package decides every `state` and `status`; the platform only persists them. Nothing in the package deletes a proof or an operation.

### Proof states

| State          | Meaning                                                                                                                                        | Balance? |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `available`    | Owned and spendable; `operationId` is null                                                                                                     | yes      |
| `held`         | Input of an in-flight melt; `operationId` names the `melt`. A null `operationId` means the holder is unknown (a migrated row without a record) | no       |
| `handedOut`    | Encoded into a token someone else may claim; `operationId` names the `send`                                                                    | no       |
| `externalized` | Handed off outside the app entirely; `operationId` names the `send`                                                                            | no       |
| `spent`        | Terminal: the mint reported it spent. Never deleted, so restore and re-ingest dedup against it                                                 | no       |

`Tokens.balances` sums `available` proofs only. `spendable` is the largest single-mint balance, because cashu cannot spend across mints in one operation.

### Operation kinds and statuses

| Kind                | Statuses                                                         | What it records                                                                                                       |
| ------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `melt`              | `pending` → `paid` \| `unpaid` \| `failed`                       | Quote, invoice, `feeReserve`, `inputsTotal`, blank-output `counter`; its inputs are the proofs `held` under it        |
| `topup`, `autoswap` | `pending` → `done` \| `failed`                                   | Quote, invoice, reserved `counter`; `locked` for NUT-20 topups, `sourceMint` for autoswaps                            |
| `send`              | `issued` \| `pending` \| `externalized` → `done` \| `returned`   | `tokenText` of the handed-out token; its proofs are `handedOut`/`externalized` under it                               |
| `receive`           | `pending` → `done` \| `failed` (a retry reopens it as `pending`) | `tokenText` of the accepted text, for dedup; the latest swap's `keysetId` and `counter`; a failure's serialized error |

`Tokens.transfers` is the `send`/`receive` view (`TokenTransfer`). The quote kinds are what the resumers finish after a crash (below).

### Who moves what

`Receive` inserts a `pending` receive, records the swap's output slot on it, swaps at the mint, stores the fresh proofs `available`, and closes the receive `done` or `failed` (with the serialized error, so the same text can be retried). Receiving the text of an unfinished receive resumes it from that slot. `Send` stores the send proofs `handedOut` under a `send`, the change `available`, then marks the consumed inputs `spent`. `Melt` stores its inputs `held` under a `pending` melt and settles them from the mint's answer. `Topup`, `Autoswap`, and `Restore` store `available` proofs. Every spend first asks the mint (NUT-07) about the `available` proofs at that mint, marks the `SPENT` ones `spent`, and offers only the confirmed `UNSPENT` ones. `Tokens` holds the transfer transitions you call from UI actions (`markIssued`, `markExternalized`, `forget`, `returnToWallet`); `Validation` marks spent proofs, releases proofs held by an unknown operation, and closes claimed sends.

## Deterministic counters and the lease

Proof secrets derive from the seed and a per-(mint, unit, keyset) counter (NUT-13). Two contexts (tabs, a service worker, two CLI processes) advancing one counter at once would derive the same secrets and collide at the mint. So every context on a device that uses the seed shares one durable `KeyValueStore`; the package serializes counter use through a lease in that store, renewed for as long as the operation holding it runs, and recovers from collisions itself. If it cannot get the lease in time, the operation fails with `CounterLockTimeout` before deriving anything.

Counters never move backwards and over-advance on ambiguity (blank outputs, collisions): a gap costs a restore scan, a reuse costs a mint rejection loop. The counter slot a quote attempt reserved is also written onto the operation (`counter`), which syncs, so a resume on another device re-derives the same outputs instead of burning a second block.

## Error classification

One rule everywhere: a proof is marked `spent` only on the mint's definitive word (NUT-07, or code 11001), and an operation is closed `failed` only on a definitive rejection. A transient failure never changes a proof's state.

| Raw failure                                    | Classified as        | Kind       |
| ---------------------------------------------- | -------------------- | ---------- |
| Mint protocol error (NUT error code), HTTP 4xx | `MintRejected`       | definitive |
| HTTP 5xx, fetch/network error, abort, timeout  | `MintUnreachable`    | transient  |
| Lease not acquired                             | `CounterLockTimeout` | transient  |

A mint answer that never arrived is not a guess either: `Validation` changes only proofs the mint answered about, and a melt whose response was lost becomes `PaymentPending`, not a failure. [errors.md](./errors.md) lists every error.

## Resuming interrupted operations

`melt`, `topup`, and `autoswap` persist their operation before the network call that could strand funds, so a crash, a closed tab, or a lost response leaves a `pending` record that is finished later, on any device that syncs the stores. Nothing looks at those records until you run the resumer: `Melt.resumePending` (one `MeltResumeResult` per melt with `held` inputs), `Topup.resumePending()` (one scoped `TopupHandle` per topup), `Autoswap.resumePendingClaims` (one `AutoswapClaimResult` per swap).

Rules shared by all three:

- Run them once when your runtime comes up and again whenever connectivity returns. Running one over the same record twice is safe.
- They never fail. A mint that cannot be reached shows up in the per-record result and the record stays `pending`.
- Only the mint's own answer retires a record. Local quote expiry is never an unlock deadline: a quote past `expiresAt` that the mint still reports pending stays pending, because the payment may yet settle. A quote without a mint-stated expiry gets a 24 h deadline, after which a mint-confirmed `UNPAID` closes it.
- Resumed minting reuses the counter slot recorded on the operation, so an interrupted claim never mints twice; a quote the mint already issued is reclaimed via NUT-09.

Each operation guide states what its resumer does per mint answer.

## Effect specifics

Services are classes you `yield*` (`Receive`, `Tokens`, `KeyValueStore`, ...). `linkshuServices(config)` is the one Layer you need. Run with `runLinkshu` (one-shot) or `ManagedRuntime.runPromise` (long-lived). Typed failures are handled with `Effect.either`, `Effect.catchTag`, and `Effect.catchTags`; bugs (a throw inside `Effect.sync`, `Amount.make(-1)`) are defects that reject the promise and are not in `E`. Effects that need `Scope.Scope` (`Topup.start`, `Topup.resumePending`) run under `Effect.scoped`, or `Scope.extend` into a scope you own so polling outlives the call.
