# Concepts

The lookup behind every linkshu call: what goes in, what comes out, how rows move, and how failures are classified. Come back to the Effect primer when a signature looks foreign.

## Drafts in, receipts out

Every operation takes a draft (`ReceiveDraft`, `SendDraft`, `MeltDraft`, `TopupDraft`, …) and returns a receipt or report (`ReceiveReceipt`, `SendReceipt`, `MeltReceipt`, `ValidationReport`, …). Both are `Schema.Class` values over branded primitives. Raw cashu-ts types never appear: the currency of the API is **token text** (`cashuA…`/`cashuB…`), never proof lists.

Receipts resolve only after the funds they describe are persisted. Change, remainders, and recovered proofs are `accepted` rows before you see the receipt.

## Branded primitives

All in `src/domain/primitives.ts`. Each is an effect `Schema` with a brand, so a plain `string` or `number` does not type-check where one is expected.

| Primitive              | Base         | Constraint                                 |
| ---------------------- | ------------ | ------------------------------------------ |
| `MintUrl`              | string       | http(s) url with a host, no trailing slash |
| `CurrencyUnit`         | string       | non-empty (`"sat"` today)                  |
| `KeysetId`             | string       | even-length hex                            |
| `TokenText`            | string       | starts with `cashu`                        |
| `Bolt11Invoice`        | string       | starts with `ln` (case-insensitive)        |
| `Amount`               | integer      | positive                                   |
| `NonNegativeAmount`    | integer      | zero or positive (fees, balances)          |
| `QuoteId`              | string       | non-empty                                  |
| `TokenRowId`           | string       | non-empty; assigned by the `TokenStore`    |
| `DeterministicCounter` | integer      | zero or positive                           |
| `UnixSeconds`          | integer      | positive                                   |
| `Bip39Seed`            | `Uint8Array` | exactly 64 bytes                           |

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

## Token rows and the lifecycle

The `TokenStore` holds one row per token (`StoredTokenRow`). Each row has an `originalTokenText` (its dedup identity, never rewritten) and a `tokenText` (the current spendable encoding, rewritten as swaps move proofs forward). The package decides every `state`; the platform only persists.

| State          | Meaning                                                                                | Balance? |
| -------------- | -------------------------------------------------------------------------------------- | -------- |
| `pending`      | In flight: an incoming token being accepted, or an outgoing one not yet confirmed sent | no       |
| `accepted`     | Owned and spendable; `tokenText` holds fresh post-swap proofs                          | **yes**  |
| `reserved`     | Earmarked for a handover, or held by a mint mid-melt; not yet issued                   | no       |
| `issued`       | Handed out for someone to claim (QR, share); pruned once claimed                       | no       |
| `externalized` | Handed off outside the app entirely                                                    | no       |
| `error`        | Accept or validation failed definitively; `error` holds the serialized tagged error    | no       |

`Tokens.balances` sums `accepted` rows only. `spendable` is the largest single-mint balance, because cashu cannot spend across mints in one operation.

Legal transitions (`src/token/internal/lifecycle.ts`):

| From           | To                                            |
| -------------- | --------------------------------------------- |
| `pending`      | `accepted`, `error`                           |
| `accepted`     | `reserved`, `issued`, `externalized`, `error` |
| `reserved`     | `accepted`, `issued`, `externalized`, `error` |
| `issued`       | `accepted`, `externalized`, `error`           |
| `externalized` | `accepted`                                    |
| `error`        | `accepted`                                    |

Who moves rows:

- `Receive` inserts `pending`, swaps at the mint, then flips to `accepted` — or to `error` on a definitive rejection.
- `Send` produces the outgoing row as `issued` or `pending` (your choice via `produceAs`) and the change as `accepted`; the source rows are removed.
- `Melt` parks its inputs as `reserved` while the mint holds them; change comes back `accepted`.
- `Topup`, `Restore`, `Autoswap` insert `accepted` rows.
- `Tokens.reserve` / `markIssued` / `markExternalized` / `returnToWallet` are the transitions you call from UI actions ([tokens.md](./tokens.md)).
- `Validation` marks fully spent rows `error` and rewrites partially spent ones; `checkIssued` removes claimed `issued` rows; `Tokens.deleteSpent` removes mint-confirmed spent rows.

A request for an illegal transition fails with `InvalidTokenTransition`. To drop a row whose funds verifiably left (a `pending` messenger send once published), call `TokenStore.remove` directly — that is a delete, not a transition.

## Deterministic counters and the lease

Proof secrets derive from the seed and a per-(mint, unit, keyset) counter (NUT-13). Two contexts (tabs, a service worker, two CLI processes) advancing one counter at once would derive the same secrets and collide at the mint. So share one durable `KeyValueStore` between every context that uses the seed; the package serializes counter use through a lease in that store and recovers from collisions itself. If it cannot get the lease in time the operation fails with `CounterLockTimeout` before deriving anything: retry later.

## Error classification

One rule everywhere: a row is marked `error` only on a **definitive** mint rejection. A **transient** failure does not establish that funds are spent; follow the operation's retry or resume instructions.

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
- [tokens.md](./tokens.md) — read model and lifecycle actions
