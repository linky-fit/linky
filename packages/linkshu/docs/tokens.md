# Tokens

`Tokens` is the read model over the inventory plus the transfer transitions callers are allowed to make. Use `proofs`, `operations`, `transfers`, and `balances` to render the wallet, the transition calls when a handed-out token changes hands, `returnToWallet` to take one back or retry a failed receive, `forget` to close a transfer, `importProofs`/`importOperation` to restore a backup, and `ingestLegacyRows` to carry the previous storage model over. The token codec exports in `token/codec.ts` are the pure functions behind all of it.

## Quick example

Prerequisites: a configured runtime ([getting-started.md](./getting-started.md)). Reads never fail; an empty wallet returns zero balances and no rows.

```ts
import { Effect } from "effect";
import { Tokens } from "@linky/linkshu";

const walletView = Effect.gen(function* () {
  const tokens = yield* Tokens;
  const balances = yield* tokens.balances;
  const transfers = yield* tokens.transfers;
  return {
    total: balances.total,
    spendable: balances.spendable,
    perMint: balances.perMint.map(
      (entry) => [entry.mint, entry.amount] as const,
    ),
    issued: transfers.filter(
      (transfer) => transfer.kind === "send" && transfer.status === "issued",
    ),
  };
});
```

Reads are pull-based: re-run them when the stores change (Linky re-runs on every Evolu query change).

## How it works

### Read model

- `proofs` — every `StoredProof`, any state, newest first.
- `operations` — every `StoredOperation`, any status, newest first.
- `transfers` — the `send` and `receive` operations as `TokenTransfer`, newest first. Quote operations (`melt`, `topup`, `autoswap`) are not transfers; read them from `operations`.
- `balances` — `WalletBalances` over `available` proofs only. `spendable` is the largest single-mint balance, because cashu cannot spend across mints in one operation.

### Send transitions

States and statuses are in [concepts.md](./concepts.md#proofs-operations-and-who-moves-them). Callers get these transitions on a `send` transfer, each `(operationId) => Effect<void, OperationNotFound | InvalidTransferTransition>`:

| Call               | From                                | To             | Proofs                                                    |
| ------------------ | ----------------------------------- | -------------- | --------------------------------------------------------- |
| `markIssued`       | `pending`                           | `issued`       | untouched — a messenger token was shown as a QR after all |
| `markExternalized` | `issued`, `pending`                 | `externalized` | its non-spent proofs → `externalized`                     |
| `forget`           | `issued`, `pending`, `externalized` | `done`         | untouched — see below                                     |

`forget` closes a transfer the caller has nothing left to do about: a send whose token verifiably reached its recipient (a published message), or a `receive` in `pending`/`failed` that will never be retried. It is not a refund — the handed-out proofs stay `handedOut` and are still reported `spent` once the recipient claims them. Everything else (`pending` → `done` on a receive, `spent` marking, closing claimed sends) is done by the operation verticals. Platforms never write states themselves.

### `returnToWallet`

`returnToWallet(operationId)` brings a transfer's funds into the balance and returns a `ReceiveReceipt` (`operationId` is the transfer it settled). It goes through the accept flow of [receive.md](./receive.md), with the transfer itself excluded from dedup:

| Transfer                                         | What happens                                                                                                                                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `send` in `issued`, `pending`, or `externalized` | the token text is **re-received**: fresh proofs are stored `available`, then the handed-out proofs are marked `spent` and the send becomes `returned`. The copy someone else may hold is now dead at the mint |
| `receive` in `pending` or `failed`               | retried in place: it reopens as `pending` (error cleared) and ends `done` with the proofs stored, or `failed` again with the new error                                                                        |
| anything else (`done`, `returned`, a quote kind) | `InvalidTransferTransition` (`OperationNotFound` for a non-transfer id)                                                                                                                                       |

On a send, a transient failure (`MintUnreachable`, `CounterLockTimeout`) leaves it exactly as it was. `TokenAlreadySpent` means the recipient claimed it: the handed-out proofs are marked `spent`, the send closes `done`, and the error is still returned — treat it as "already claimed", not as a loss. Any other definitive rejection is recorded in `error` without changing the status. This is the recovery path for a `pending` message send that never confirmed and for an unclaimed `issued` token; a melt's `held` inputs are not a transfer and belong to [`Melt.resumePending`](./melt.md#resumepending--run-it-at-startup).

### Backup import

`importProofs(drafts)` restores proofs from a backup exactly as it states them (`ImportProofDraft` has the fields of `NewProof`: `mint`, `unit`, `keysetId`, `amount`, `secret`, `C`, `dleq`, `state`, `operationId`) and returns how many were added. Secrets the inventory already holds are skipped, so a backup imported twice adds nothing; there is no mint check, so a proof comes back in the state it left with and the next validation reconciles it. `importOperation(draft: NewOperation)` restores one operation and returns its `OperationId`; an existing operation with the same key is replaced. Import operations before proofs when the backup has both, so the proofs' `operationId` links resolve. These are the only way platform code writes inventory rows it did not obtain through an operation.

```ts
import { Effect, Schema } from "effect";
import { ImportProofDraft, NewOperation, Tokens } from "@linky/linkshu";

const decodeProofs = Schema.decodeUnknownOption(Schema.Array(ImportProofDraft));
const decodeOperations = Schema.decodeUnknownOption(Schema.Array(NewOperation));

const restoreBackup = (backup: { proofs: unknown; operations: unknown }) =>
  Effect.gen(function* () {
    const proofs = decodeProofs(backup.proofs);
    const operations = decodeOperations(backup.operations);
    if (proofs._tag === "None" || operations._tag === "None") return null;
    const tokens = yield* Tokens;
    for (const operation of operations.value) {
      yield* tokens.importOperation(operation);
    }
    return yield* tokens.importProofs(proofs.value);
  });
```

### `adoptToken`

`adoptToken(text)` stores a token's proofs as `available` without re-signing them at the mint and returns the amount added (`NonNegativeAmount`; secrets already stored are skipped). It fails with `TokenParseFailed` when the text carries no decodable token. It exists for a wallet that only ever spends one token it already trusts — the site's `/cashu/` redemption page — and must not be used for anything received from someone else, because the sender keeps a spendable copy; that is what `Receive` is for.

### `ingestLegacyRows`

`ingestLegacyRows(rows)` carries rows of the pre-inventory storage model (`LegacyTokenRow`: `id`, `originalTokenText`, `tokenText`, `state`, `error`, `createdAt` — the web app's `cashuToken` table and old backups) into proofs and operations, and returns a `LegacyIngestReport` (`ingestedRows`, `proofs`). A row is ingested when any of its proofs is not yet stored; ids derive from secrets, so it is idempotent and safe to run on every load and on every device. No mint is contacted. Per legacy state:

| Legacy row state         | Becomes                                                                                                                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pending`                | skipped                                                                                                                                                                                            |
| `accepted`               | `available` proofs                                                                                                                                                                                 |
| `reserved`               | `held` proofs, linked to the pending `melt` at that mint whose `inputsTotal` equals the row's total (each melt linked once); no such melt → `operationId: null`, released by `Validation.checkAll` |
| `issued`, `externalized` | a `send` operation in that status (`createdAt` from the row) with the proofs `handedOut` / `externalized` under it                                                                                 |
| `error`                  | `spent` proofs when `error` is a serialized `TokenAlreadySpent`; otherwise `available`, for the next mint check to decide                                                                          |

Rows whose text no longer decodes are skipped. Linky runs it from `useLinkshuComposition.ts` over the legacy table on every load.

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

`TokenTransfer` (`token/domain.ts`):

| Field       | Type                           | Notes                                            |
| ----------- | ------------------------------ | ------------------------------------------------ |
| `id`        | `OperationId`                  |                                                  |
| `kind`      | `"send" \| "receive"`          |                                                  |
| `status`    | `OperationStatus`              |                                                  |
| `tokenText` | `TokenText`                    | the handed-out or accepted text; carries secrets |
| `mint`      | `MintUrl`                      |                                                  |
| `unit`      | `CurrencyUnit`                 |                                                  |
| `amount`    | `Amount`                       |                                                  |
| `error`     | `Schema.NullOr(Schema.String)` | serialized tagged error of the last failure      |
| `createdAt` | `UnixSeconds`                  |                                                  |

`WalletBalances`: `total: NonNegativeAmount`, `spendable: NonNegativeAmount`, `perMint: Schema.Array(MintBalance)` with `MintBalance { mint: MintUrl, amount: NonNegativeAmount }`.

`StoredProof` and `StoredOperation` are described in [ports.md](./ports.md).

## Errors

| Tag                         | Raised by                               | When                                                     | What to do                                                                     |
| --------------------------- | --------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `OperationNotFound`         | transitions, `forget`, `returnToWallet` | no transfer with that id (quote operations do not count) | drop the reference                                                             |
| `InvalidTransferTransition` | transitions, `forget`, `returnToWallet` | the status forbids it (`from`, `to` in the error)        | refresh the transfer and re-check its status                                   |
| `ReceiveError` members      | `returnToWallet`                        | see [receive.md](./receive.md#errors)                    | same handling as a receive; `TokenAlreadySpent` on a send means it was claimed |

`proofs`, `operations`, `transfers`, `balances`, `importProofs`, `importOperation`, and `ingestLegacyRows` never fail; `adoptToken` fails only with `TokenParseFailed`.

## Related

- [receive.md](./receive.md), [send.md](./send.md), [validation.md](./validation.md)
- [concepts.md](./concepts.md#proofs-operations-and-who-moves-them) — states and statuses
- [ports.md](./ports.md) — `ProofStore`, `OperationStore`, why ids derive from secrets and operation keys
