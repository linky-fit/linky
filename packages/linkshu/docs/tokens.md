# Tokens

`Tokens` is the read model over stored rows plus the lifecycle transitions callers are allowed to make. Use `list` and `balances` to render the wallet, the transition calls when a token changes hands, `returnToWallet` to take one back, and `deleteSpent` to clean up. The token codec exports in `token/codec.ts` are the pure functions behind all of it.

## Quick example

Prerequisites: a configured runtime ([getting-started.md](./getting-started.md)). Reads never fail; an empty wallet returns zero balances and no rows.

```ts
import { Effect } from "effect";
import { Tokens } from "@linky/linkshu";

const walletView = Effect.gen(function* () {
  const tokens = yield* Tokens;
  const balances = yield* tokens.balances;
  const rows = yield* tokens.list;
  return {
    total: balances.total,
    spendable: balances.spendable,
    perMint: balances.perMint.map(
      (entry) => [entry.mint, entry.amount] as const,
    ),
    issued: rows.filter((row) => row.state === "issued"),
  };
});
```

Reads are pull-based: re-run them when the store changes (Linky re-runs on every Evolu query change).

## How it works

### Read model

- `list` — every row whose text still parses, enriched into `WalletToken`, newest first. Rows that no longer parse stay in the store but are omitted.
- `balances` — `WalletBalances` over `accepted` rows only. `spendable` is the largest single-mint balance, because cashu cannot spend across mints in one operation.

### Lifecycle

States, their meanings, and the legal transitions are in [concepts.md](./concepts.md#token-rows-and-the-lifecycle). Only `accepted` counts as balance. Callers get three pure transitions, each `(rowId) => Effect<void, TokenRowNotFound | InvalidTokenTransition>`:

| Call               | Meaning                                                              |
| ------------------ | -------------------------------------------------------------------- |
| `reserve`          | earmark an `accepted` row for a handover that has not happened yet   |
| `markIssued`       | the token left as a QR/share; watch it with `Validation.checkIssued` |
| `markExternalized` | the token was handed off outside the app entirely                    |

Everything else (`pending` → `accepted`, `error` marking, removal of consumed sources) is done by the operation verticals. Platforms never write states themselves.

### `returnToWallet`

`returnToWallet(rowId)` brings a row back to `accepted` and returns a `ReceiveReceipt`. Its behavior depends on the state:

| Row state                                    | What happens                                                                                                                                                                                                                                                                                  |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accepted`                                   | `InvalidTokenTransition` — nothing to return                                                                                                                                                                                                                                                  |
| `reserved`                                   | released locally, without a mint check. Inputs of an interrupted melt belong to [`Melt.resumePending`](./melt.md#resumepending--run-it-at-startup), which asks the mint first; returning them by hand while the mint still holds them makes the balance count funds that may already be spent |
| `issued`, `externalized`, `pending`, `error` | the row's text is **re-received** through the accept flow: a fresh `accepted` row gets swapped proofs, then the old row is removed. The copy someone else may hold is now spent at the mint                                                                                                   |

On a re-receive, dedup ignores the replaced row. A transient failure leaves it exactly as it was; a definitive failure (`TokenAlreadySpent`, `MintRejected`) lands on the replaced row as `error` where the state machine allows (an `externalized` row keeps its state). This is the recovery path for a `pending` message send that never confirmed, an unclaimed `issued` token, and an `error` row that still holds live proofs after a partial spend.

### `deleteSpent`

Removes rows the mints confirm fully spent and returns `DeletedSpentToken[]` (`rowId`, `amount`). It sweeps `accepted` and `error` rows only. It runs its own NUT-07 check: rows already carrying a recorded `TokenAlreadySpent` are re-confirmed, because a receive rejected over a _partially_ spent token records that error while the text still holds live proofs. An unreachable mint or an unanswered proof keeps every row.

Rows in other states are never swept: `issued` rows are pruned by `Validation.checkIssued` once claimed; `externalized` rows come back only through `returnToWallet`; `reserved` and `pending` rows belong to an operation in flight (a melt's `reserved` inputs are settled by `Melt.resumePending`).

## Token codec

Pure and total: malformed input yields `null`, never a throw. Import from `@linky/linkshu`.

| Function                           | Use                                                                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `extractTokenText(text)`           | find a token in arbitrary text (bare, `cashu:` schemes, URLs, embedded JSON) → `TokenText \| null`                     |
| `normalizeTokenText(raw)`          | trim and normalize any supported encoding (legacy JSON becomes v3 text)                                                |
| `parseTokenText(raw)`              | `ParsedToken` summary (`amount`, `mint`, `unit`, `memo`) without exposing proofs — for previews and dedup              |
| `decodeTokenText(raw, keysetIds?)` | full `DecodedToken` (`mint`, `unit`, `memo`, `proofs`); pass the mint's keyset ids to expand short v2 ids in v4 tokens |
| `encodeToken(decoded)`             | canonical v4 `TokenText`; round-trips with `decodeTokenText`                                                           |

Supported formats: v3 (`cashuA`, base64url JSON), v4 (`cashuB`, base64url CBOR), and legacy cashu.me plain-JSON proof bundles (normalized to standard token text). `mint`/`unit` on `ParsedToken` are `null` when the encoding does not state them unambiguously.

## Inputs and outputs

`WalletToken` (`token/domain.ts`):

| Field       | Type                           | Notes                                         |
| ----------- | ------------------------------ | --------------------------------------------- |
| `id`        | `TokenRowId`                   |                                               |
| `state`     | `TokenState`                   |                                               |
| `tokenText` | `TokenText`                    | current encoding                              |
| `mint`      | `Schema.NullOr(MintUrl)`       |                                               |
| `unit`      | `Schema.NullOr(CurrencyUnit)`  |                                               |
| `amount`    | `Amount`                       |                                               |
| `error`     | `Schema.NullOr(Schema.String)` | serialized tagged error; null outside `error` |
| `createdAt` | `UnixSeconds`                  |                                               |

`WalletBalances`: `total: NonNegativeAmount`, `spendable: NonNegativeAmount`, `perMint: Schema.Array(MintBalance)` with `MintBalance { mint: MintUrl, amount: NonNegativeAmount }`.

## Errors

| Tag                      | Raised by                        | When                                                     | What to do                             |
| ------------------------ | -------------------------------- | -------------------------------------------------------- | -------------------------------------- |
| `TokenRowNotFound`       | transitions, `returnToWallet`    | no row with that id                                      | drop the reference                     |
| `InvalidTokenTransition` | transitions, `returnToWallet`    | the state machine forbids it (`from`, `to` in the error) | refresh the row and re-check the state |
| `ReceiveError` members   | `returnToWallet` on a re-receive | see [receive.md](./receive.md#errors)                    | same handling as a receive             |

`list`, `balances`, and `deleteSpent` never fail.

## Related

- [receive.md](./receive.md), [send.md](./send.md), [validation.md](./validation.md)
- [concepts.md](./concepts.md#token-rows-and-the-lifecycle) — states and transitions
- [ports.md](./ports.md) — `TokenStore`, `StoredTokenRow`, why ids may derive from `originalTokenText`
