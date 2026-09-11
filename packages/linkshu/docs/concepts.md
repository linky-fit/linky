# Concepts

The lookup behind every linkshu call: what goes in, what comes out, how proofs and operations move, and how failures are classified. Come back to the Effect primer when a signature looks foreign.

## Drafts in, receipts out

Every operation takes a draft (`ReceiveDraft`, `SendDraft`, `MeltDraft`, `TopupDraft`, …) and returns a receipt or report (`ReceiveReceipt`, `SendReceipt`, `MeltReceipt`, `ValidationReport`, …). Both are `Schema.Class` values over branded primitives. Raw cashu-ts types never appear: the currency of the API is **token text** (`cashuA…`/`cashuB…`), never proof lists.

Receipts resolve only after the funds they describe are persisted. Change, remainders, and recovered proofs are `available` in the inventory before you see the receipt.

## Branded primitives

All in `src/domain/primitives.ts`. Each is an effect `Schema` with a brand, so a plain `string` or `number` does not type-check where one is expected.

| Primitive              | Base         | Constraint                                                       |
| ---------------------- | ------------ | ---------------------------------------------------------------- |
| `MintUrl`              | string       | http(s) url with a host, no trailing slash                       |
| `CurrencyUnit`         | string       | non-empty (`"sat"` today)                                        |
| `KeysetId`             | string       | even-length hex                                                  |
| `TokenText`            | string       | starts with `cashu`                                              |
| `Bolt11Invoice`        | string       | starts with `ln` (case-insensitive)                              |
| `Amount`               | integer      | positive                                                         |
| `NonNegativeAmount`    | integer      | zero or positive (fees, balances)                                |
| `QuoteId`              | string       | non-empty                                                        |
| `ProofId`              | string       | non-empty; derived from the proof secret by the `ProofStore`     |
| `OperationId`          | string       | non-empty; derived from `operationKeyOf` by the `OperationStore` |
| `DeterministicCounter` | integer      | zero or positive                                                 |
| `UnixSeconds`          | integer      | positive                                                         |
| `Bip39Seed`            | `Uint8Array` | exactly 64 bytes                                                 |

Three ways to construct one:

```ts
import { Amount, MintUrl, SendDraft } from "@linky/linkshu";
import { Schema } from "effect";

// 1. `.make` — throws on invalid input; use when the value is already known good.
const amount = Amount.make(21);
const mint = MintUrl.make("https://mint.example");

// 2. Option-returning decoder — for user input you validate yourself.
const decodeAmount = Schema.decodeUnknownOption(Amount);
const maybeAmount = decodeAmount(Number("21")); // Option<Amount>

// 3. Decode a whole draft from plain values; every field is validated at once.
const decodeSendDraft = Schema.decodeUnknownSync(SendDraft);
const draft = decodeSendDraft({
  mint: "https://mint.example",
  amount: 21,
  produceAs: "issued",
});
```

For mint urls, use `parseMintUrl(raw)`: it trims, strips trailing slashes, and returns `MintUrl | null`. Store and compare only that normalized form, or two spellings of one mint fork its counters.

## Proofs, operations, and who moves them

The wallet is an inventory. The `ProofStore` holds one row per proof (`StoredProof`: mint, unit, keyset, amount, secret, `C`, `dleq`, `state`, `operationId`); the `OperationStore` holds one row per operation (`StoredOperation`: `kind`, `status`, mint, amounts, quote and invoice for quote kinds, `tokenText` for transfers, `counter`, `error`). The package decides every `state` and `status`; the platform only persists.

### Proof states

| State          | Meaning                                                                                                                                                             | Balance? |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `available`    | Owned and spendable; `operationId` is null                                                                                                                          | **yes**  |
| `held`         | Input of an in-flight melt; `operationId` names the `melt` operation. A null `operationId` means the holder is unknown (a migrated `reserved` row without a record) | no       |
| `handedOut`    | Encoded into a token someone else may claim; `operationId` names the `send`                                                                                         | no       |
| `externalized` | Handed off outside the app entirely; `operationId` names the `send`                                                                                                 | no       |
| `spent`        | Terminal: the mint reported it spent. Never deleted, so restore and re-ingest dedup against it                                                                      | no       |

`Tokens.balances` sums `available` proofs only. `spendable` is the largest single-mint balance, because cashu cannot spend across mints in one operation.

### Operation kinds and statuses

| Kind                | Statuses                                                         | What it records                                                                                                |
| ------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `melt`              | `pending` → `paid` \| `unpaid` \| `failed`                       | Quote, invoice, `feeReserve`, `inputsTotal`, blank-output `counter`; its inputs are the proofs `held` under it |
| `topup`, `autoswap` | `pending` → `done` \| `failed`                                   | Quote, invoice, reserved `counter` (`locked` for NUT-20 topups, `sourceMint` for autoswaps)                    |
| `send`              | `issued` \| `pending` \| `externalized` → `done` \| `returned`   | `tokenText` of the handed-out token; its proofs are `handedOut`/`externalized` under it                        |
| `receive`           | `pending` → `done` \| `failed` (a retry reopens it as `pending`) | `tokenText` of the accepted text, for dedup; a failure's serialized error                                      |

`Tokens.transfers` is the `send`/`receive` view (`TokenTransfer`); the quote kinds are what the resumers (`Melt.resumePending`, `Topup.resumePending`, `Autoswap.resumePendingClaims`) finish after a crash.

### Who moves what

- `Receive` inserts a `pending` receive, swaps at the mint, stores the fresh proofs `available`, and closes the receive `done` — or `failed` with the serialized error, so pasting the text again retries it.
- `Send` stores the send proofs `handedOut` under a `send` in the status you choose via `produceAs`, the change `available`, and then marks the consumed inputs `spent`.
- `Melt` stores its inputs `held` under a `pending` melt. `PAID`: change `available`, inputs `spent`, melt `paid`. `UNPAID`: inputs back to `available`, melt `unpaid`. Rejected: inputs `available`, melt `failed`. Unsettled: everything stays for `Melt.resumePending`.
- `Topup`, `Autoswap`, `Restore` store `available` proofs; the quote operations close `done`.
- Every spend (`Send`, `Melt`, `Autoswap`) first asks the mint (NUT-07) about the `available` proofs at that mint, marks the `SPENT` ones `spent`, and offers only the confirmed `UNSPENT` ones.
- `Tokens.markIssued` / `markExternalized` / `forget` / `returnToWallet` are the transfer transitions you call from UI actions ([tokens.md](./tokens.md)).
- `Validation.checkAll` marks spent proofs `spent` and releases proofs held by an unknown operation once the mint says they are unspent; `checkIssued` marks claimed proofs `spent` and closes the send `done`.

A transfer transition the status does not allow fails with `InvalidTransferTransition`; an id that is not a transfer fails with `OperationNotFound`. Nothing in the package deletes a proof or an operation.

## Deterministic counters and the lease

Proof secrets derive from the seed and a per-(mint, unit, keyset) counter (NUT-13). Two contexts (tabs, a service worker, two CLI processes) advancing one counter at once would derive the same secrets and collide at the mint. So share one durable `KeyValueStore` between every context that uses the seed; the package serializes counter use through a lease in that store and recovers from collisions itself. If it cannot get the lease in time the operation fails with `CounterLockTimeout` before deriving anything: retry later.

The counter a quote attempt reserved is also written onto the operation (`counter`), which syncs; so a resume on another device re-derives the same outputs instead of burning a second block.

## Error classification

One rule everywhere: a proof is marked `spent` only on the mint's **definitive** word, and an operation is closed `failed` only on a definitive rejection. A **transient** failure does not establish that funds are spent; follow the operation's retry or resume instructions.

| Raw failure                                                | Classified as        | Kind       |
| ---------------------------------------------------------- | -------------------- | ---------- |
| Mint protocol error (`MintOperationError`, NUT error code) | `MintRejected`       | definitive |
| HTTP 4xx                                                   | `MintRejected`       | definitive |
| HTTP 5xx, fetch/network error, abort, timeout              | `MintUnreachable`    | transient  |
| Lease not acquired                                         | `CounterLockTimeout` | transient  |

The raw cashu-ts error never crosses the boundary. [errors.md](./errors.md) lists every error and what to do with it.

## Effect primer

Only what you need to use this package.

**An `Effect<A, E, R>` is a description** of a computation that succeeds with `A`, fails with a typed `E`, and needs services `R`. Nothing runs until you hand it to a runtime.

**Write sequential code with `Effect.gen`**; `yield*` unwraps an effect (or fails the whole generator with its error):

```ts
import { Tokens } from "@linky/linkshu";
import { Effect } from "effect";

const total = Effect.gen(function* () {
  const tokens = yield* Tokens; // the service instance
  const balances = yield* tokens.balances; // an Effect<WalletBalances>
  return balances.total;
});
```

**Services** are classes you `yield*` (`Receive`, `Tokens`, `KeyValueStore`, …). A **Layer** is how a service gets built; `linkshuServices(config)` is the one layer you need, and `Effect.provide`/`Layer.provideMerge` attach layers to effects and other layers.

**Run** an effect with `runLinkshu` (one-shot), `ManagedRuntime.runPromise` (long-lived), or in tests `Effect.runPromise(program.pipe(Effect.provide(layer)))`.

**Typed failures vs defects**: a `yield*` of a failing effect fails the program with that error type, which `Effect.either`, `Effect.catchTag`, and `Effect.catchTags` handle. Bugs (a throw inside `Effect.sync`, `Amount.make(-1)`) are defects; they reject the promise and are not in `E`.

**Scopes**: some effects need `Scope.Scope` (`Topup.start`, `Topup.resumePending`). Wrap them in `Effect.scoped` for a self-contained run, or `Scope.extend` into a scope you own so background polling outlives the call.

## Related

- [getting-started.md](./getting-started.md) — wiring and first call
- [ports.md](./ports.md) — what the stores must guarantee
- [errors.md](./errors.md) — the tagged error catalogue
- [tokens.md](./tokens.md) — read model and transfer actions
