# Tokens

`Tokens` is the read model over the inventory plus the transitions callers may make on transfers, the backup import, and the pure token codec behind all of it.

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

Reads are pull-based: re-run them when the stores change. `transfers` covers `send` and `receive` only; quote operations (`melt`, `topup`, `autoswap`) and deferred receives (`deferredReceive`) are read from `operations`. `balances` sums `available` proofs only. `TokenTransfer.tokenText` carries proof secrets; every other field is safe to display.

## How it works

### Send transitions

Each is `(operationId) => Effect<void, OperationNotFound | InvalidTransferTransition>`, and `forget` adds `CounterLockTimeout`; states and statuses are in [concepts.md](./concepts.md#proofs-and-operations).

| Call               | From                                | To             | Proofs                                |
| ------------------ | ----------------------------------- | -------------- | ------------------------------------- |
| `markIssued`       | `pending`                           | `issued`       | untouched                             |
| `markExternalized` | `issued`, `pending`                 | `externalized` | its non-spent proofs → `externalized` |
| `forget`           | `issued`, `pending`, `externalized` | `done`         | untouched                             |

`forget` closes a transfer the caller has nothing left to do about: a send whose token verifiably reached its recipient, or a `receive` in `pending`/`failed` that will never be retried. It is not a refund; the handed-out proofs stay `handedOut` and are still reported `spent` once the recipient claims them.

`forget` also closes a `pending` `deferredReceive` (`done`) whose mint the user gives up on; any other status fails with `InvalidTransferTransition`, as does a deferral a resume pass has just handed to its `receive` (the two take turns, see [receive.md](./receive.md#deferred-receives)). Nothing was received, so the token's value is gone unless the caller keeps its `tokenText` first. Receiving that text again later keeps it as a `pending` deferral once more, or receives it if the mint answers ([receive.md](./receive.md#deferred-receives)).

### `returnToWallet`

`returnToWallet(operationId)` brings a transfer's funds into the balance and returns a `ReceiveReceipt`. It runs the accept flow of [receive.md](./receive.md) with the transfer itself excluded from dedup:

| Transfer                                         | What happens                                                                                                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `send` in `issued`, `pending`, or `externalized` | the token text is re-received: fresh proofs stored `available`, the handed-out proofs marked `spent`, the send `returned`. Any copy someone else holds is now dead at the mint |
| `receive` in `pending` or `failed`               | resumed in place, as receiving its text again does ([receive.md](./receive.md#resuming-an-unfinished-receive)): ends `done` with the proofs stored, or `failed` again          |
| anything else                                    | `InvalidTransferTransition` (`OperationNotFound` for a non-transfer id)                                                                                                        |

A resumed receive is left exactly as it was when the proof state check stops it: `TokenAlreadySpent` if the mint reports the proofs spent and its recorded slot holds nothing, `MintUnreachable` or `MintRejected` if the mint cannot answer, and `TokenAlreadyKnown` naming it if another device's `done` synced in while the mint answered. A send is taken back without the check.

On a send, a transient failure (`MintUnreachable`, `CounterLockTimeout`) leaves it exactly as it was. `TokenAlreadySpent` means the recipient claimed it: the proofs are marked `spent`, the send closes `done`, and the error is still returned; treat it as "already claimed", not as a loss. Any other rejection is recorded in `error` without changing the status. A melt's `held` inputs are not a transfer and belong to [`Melt.resumePending`](./melt.md#resumepending).

### `reclaim`

`reclaim(proofIds)` checks the selected stored proofs at their mints and re-signs the confirmed unspent ones into fresh `available` proofs. It accepts `available`, `handedOut`, and `externalized` proofs, including ones linked to closed sends or with no operation; `held` proofs, missing ids, and proofs already `spent` are skipped. Requests are grouped by mint; a failed mint or swap does not stop the others. Spent inputs are marked individually, unanswered ones stay unchanged, and fresh proofs are persisted before the reclaimed inputs become `spent`. A send closes `returned` when all its linked proofs are spent and this call reclaimed some of them; a fully claimed send closes `done`. The `ReclaimReport` carries `reclaimedAmount` (after fees) and the ids in `reclaimedProofs`, `spentProofs`, and `unresolvedProofs` (retry those later). It never fails, and repeating reclaimed ids does not swap again.

### Backup import

`importProofs` restores proofs exactly as the backup states them and skips secrets the inventory already holds, so importing twice adds nothing. There is no mint check: a proof comes back in the state it left with and the next validation reconciles it. `importOperation` restores one operation; an existing operation with the same key is replaced. Import operations before proofs so the proofs' `operationId` links resolve. Neither fails.

`adoptToken(text)` stores a token's proofs as `available` without re-signing them at the mint. It is for a wallet that exists to spend one token it already trusts; anything received from someone else goes through `Receive`, because the sender keeps a spendable copy. `ingestLegacyRows` is a migration-only entry for the pre-inventory token-row model; new consumers do not need it.

## Token codec

`extractTokenText`, `normalizeTokenText`, `parseTokenText`, `decodeTokenText`, and `encodeToken` are pure and total: malformed input yields `null`, never a throw. Supported formats are v3 (`cashuA`, base64url JSON), v4 (`cashuB`, base64url CBOR), and legacy cashu.me plain-JSON proof bundles; `encodeToken` always produces v4. `parseTokenText` gives the summary for a preview without exposing proofs; `decodeTokenText` needs the mint's keyset ids only to expand short v2 ids in v4 tokens.

## Errors

| Tag                         | Raised by                               | When                                                                                                |
| --------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `OperationNotFound`         | transitions, `forget`, `returnToWallet` | no transfer with that id (quote operations do not count; `forget` also accepts a `deferredReceive`) |
| `InvalidTransferTransition` | transitions, `forget`, `returnToWallet` | the status forbids it (`from`, `to` in the error)                                                   |
| `CounterLockTimeout`        | `forget` of a `deferredReceive`         | another context held the mint's receive lease for 30 s; the deferral is untouched, retry            |
| `ReceiveError` members      | `returnToWallet`                        | see [receive.md](./receive.md#errors)                                                               |
| `TokenParseFailed`          | `adoptToken`                            | the text holds no decodable token                                                                   |

## Related

- [receive.md](./receive.md), [send.md](./send.md), [validation.md](./validation.md)
- [ports.md](./ports.md): why ids derive from secrets and operation keys
