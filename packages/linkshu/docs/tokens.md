# Tokens

`Tokens` is the read model over the inventory plus the transitions callers may make: `proofs`, `operations`, `transfers`, and `balances` to render the wallet; `markIssued`, `markExternalized`, and `forget` when a handed-out token changes hands; `returnToWallet` to take one back or retry a failed receive; `reclaim` to re-sign selected proofs; `importProofs`/`importOperation` for backups. The token codec exports are the pure functions behind all of it.

## Example

Reads never fail; an empty wallet returns zero balances and no rows.

```ts
import { Effect } from "effect";
import { Tokens } from "@linky-fit/linkshu";

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
    issued: transfers.filter((t) => t.kind === "send" && t.status === "issued"),
  };
});
```

Reads are pull-based: re-run them when the stores change.

## How it works

### Read model

- `proofs`: every `StoredProof`, any state, newest first.
- `operations`: every `StoredOperation`, any status, newest first.
- `transfers`: the `send` and `receive` operations as `TokenTransfer`, newest first. Quote operations (`melt`, `topup`, `autoswap`) are not transfers; read them from `operations`.
- `balances`: `WalletBalances` over `available` proofs only. `spendable` is the largest single-mint balance.

`TokenTransfer.tokenText` carries proof secrets; every other field is safe to display.

### Send transitions

Each is `(operationId) => Effect<void, OperationNotFound | InvalidTransferTransition>`; states and statuses are in [concepts.md](./concepts.md#proofs-and-operations).

| Call               | From                                | To             | Proofs                                |
| ------------------ | ----------------------------------- | -------------- | ------------------------------------- |
| `markIssued`       | `pending`                           | `issued`       | untouched                             |
| `markExternalized` | `issued`, `pending`                 | `externalized` | its non-spent proofs → `externalized` |
| `forget`           | `issued`, `pending`, `externalized` | `done`         | untouched                             |

`forget` closes a transfer the caller has nothing left to do about: a send whose token verifiably reached its recipient, or a `receive` in `pending`/`failed` that will never be retried. It is not a refund; the handed-out proofs stay `handedOut` and are still reported `spent` once the recipient claims them.

### `returnToWallet`

`returnToWallet(operationId)` brings a transfer's funds into the balance and returns a `ReceiveReceipt`. It runs the accept flow of [receive.md](./receive.md) with the transfer itself excluded from dedup:

| Transfer                                         | What happens                                                                                                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `send` in `issued`, `pending`, or `externalized` | the token text is re-received: fresh proofs stored `available`, the handed-out proofs marked `spent`, the send `returned`. Any copy someone else holds is now dead at the mint |
| `receive` in `pending` or `failed`               | retried in place: reopens as `pending` (error cleared), ends `done` with the proofs stored, or `failed` again                                                                  |
| anything else                                    | `InvalidTransferTransition` (`OperationNotFound` for a non-transfer id)                                                                                                        |

On a send, a transient failure (`MintUnreachable`, `CounterLockTimeout`) leaves it exactly as it was. `TokenAlreadySpent` means the recipient claimed it: the proofs are marked `spent`, the send closes `done`, and the error is still returned; treat it as "already claimed", not as a loss. Any other rejection is recorded in `error` without changing the status. A melt's `held` inputs are not a transfer and belong to [`Melt.resumePending`](./melt.md#resumepending).

### `reclaim`

`reclaim(proofIds)` checks the selected stored proofs at their mints and re-signs the confirmed unspent ones into fresh `available` proofs. It accepts `available`, `handedOut`, and `externalized` proofs, including ones linked to closed sends or with no operation; `held` proofs, missing ids, and proofs already `spent` are skipped. Requests are grouped by mint; a failed mint or swap does not stop the others. Spent inputs are marked individually, unanswered ones stay unchanged, and fresh proofs are persisted before the reclaimed inputs become `spent`. A send closes `returned` when all its linked proofs are spent and this call reclaimed some of them; a fully claimed send closes `done`. The `ReclaimReport` carries `reclaimedAmount` (after fees) and the ids in `reclaimedProofs`, `spentProofs`, and `unresolvedProofs` (retry those later). It never fails, and repeating reclaimed ids does not swap again.

### Backup import

`importProofs(drafts: ImportProofDraft[])` restores proofs exactly as the backup states them and returns how many were added; secrets the inventory already holds are skipped, so importing twice adds nothing. There is no mint check: a proof comes back in the state it left with and the next validation reconciles it. `importOperation(draft: NewOperation)` restores one operation and returns its id; an existing operation with the same key is replaced. Import operations before proofs so the proofs' `operationId` links resolve. Neither fails.

### `adoptToken`

`adoptToken(text)` stores a token's proofs as `available` without re-signing them at the mint and returns the amount added (secrets already stored are skipped). It fails only with `TokenParseFailed`. It is for a wallet that exists to spend one token it already trusts; anything received from someone else goes through `Receive`, because the sender keeps a spendable copy.

### `ingestLegacyRows`

`ingestLegacyRows(rows: LegacyTokenRow[])` is a migration-only entry that turns rows of a pre-inventory token-row model into proofs and operations; it is idempotent, contacts no mint, and never fails. New consumers do not need it.

## Token codec

Pure and total: malformed input yields `null`, never a throw.

| Function                           | Use                                                                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `extractTokenText(text)`           | find a token in arbitrary text (bare, `cashu:` schemes, URLs, embedded JSON) → `TokenText \| null`                     |
| `normalizeTokenText(raw)`          | trim and normalize any supported encoding (legacy JSON becomes v3 text)                                                |
| `parseTokenText(raw)`              | `ParsedToken` summary (`amount`, `mint`, `unit`, `memo`) without exposing proofs; for previews and dedup               |
| `decodeTokenText(raw, keysetIds?)` | full `DecodedToken` (`mint`, `unit`, `memo`, `proofs`); pass the mint's keyset ids to expand short v2 ids in v4 tokens |
| `encodeToken(decoded)`             | canonical v4 `TokenText`; round-trips with `decodeTokenText`                                                           |

Supported formats: v3 (`cashuA`, base64url JSON), v4 (`cashuB`, base64url CBOR), and legacy cashu.me plain-JSON proof bundles. `mint`/`unit` on `ParsedToken` are `null` when the encoding does not state them unambiguously.

## Errors

| Tag                         | Raised by                               | When                                                     |
| --------------------------- | --------------------------------------- | -------------------------------------------------------- |
| `OperationNotFound`         | transitions, `forget`, `returnToWallet` | no transfer with that id (quote operations do not count) |
| `InvalidTransferTransition` | transitions, `forget`, `returnToWallet` | the status forbids it (`from`, `to` in the error)        |
| `ReceiveError` members      | `returnToWallet`                        | see [receive.md](./receive.md#errors)                    |

## Related

- [receive.md](./receive.md), [send.md](./send.md), [validation.md](./validation.md)
- [ports.md](./ports.md): why ids derive from secrets and operation keys
