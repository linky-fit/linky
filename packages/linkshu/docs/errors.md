# Errors

Every failure linkshu reports, what it means, and how to handle it. The operation guides list only their guide-specific tags and link here.

## The catalogue

All errors are `Schema.TaggedError` classes. Branch on `_tag`; never string-match `detail`.

| Tag                         | Fields                                     | When                                                                                                                                                             | Caller should                                                                                                                                |
| --------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `TokenParseFailed`          | `reason`, `detail`                         | No token in the text, or undecodable. `reason` is `empty`, `no-token-found`, `undecodable`, `no-proofs`, or `multiple-mints`.                                    | Tell the user the input is not a token. Nothing was stored.                                                                                  |
| `TokenAlreadyKnown`         | `operationId`                              | A transfer carries this text (`operationId` set), or its proofs are already in the inventory (`operationId` is the holding operation, or null for balance).      | Show "already in wallet"; link to the transfer when there is one.                                                                            |
| `TokenAlreadySpent`         | `mint`                                     | The mint definitively reported the proofs spent (NUT-07 / code 11001).                                                                                           | Show "already spent". A receive closed `failed`; a returned send closed `done` (the recipient claimed it).                                   |
| `MintUnreachable`           | `mint`, `detail`                           | Network, timeout, 5xx. Transient. From `Melt.melt` it means the request never left (no melt operation exists); a lost melt response is `PaymentPending` instead. | Retry later; no proof changed state (a receive is left `failed` for the retry).                                                              |
| `MintRejected`              | `mint`, `code`, `detail`                   | Definitive protocol rejection (`code` is the NUT error code when known), HTTP 4xx, or malformed mint data.                                                       | Surface `detail`; the flow already persisted whatever the rejection implies.                                                                 |
| `InsufficientFunds`         | `mint`, `required`, `available`            | Confirmed-unspent balance at `mint` cannot cover the amount (plus fee reserve for melt and autoswap).                                                            | Offer a smaller amount or a top-up; `required`/`available` size the next attempt.                                                            |
| `AmountConsumedByFee`       | `mint`, `amount`, `fee`                    | The mint's input fee to swap the proofs (NUT-02) is at least their value; no swap or inventory change was attempted.                                             | Tell the user the amount has to exceed `fee`.                                                                                                |
| `QuoteExpired`              | `quoteId`, `mint`                          | The mint says the quote expired before it settled.                                                                                                               | Start a fresh quote.                                                                                                                         |
| `PaymentFailed`             | `mint`, `quoteId`, `detail`                | The mint reported the Lightning payment `UNPAID`, or the quote was not payable.                                                                                  | Show failure; balance is intact.                                                                                                             |
| `PaymentPending`            | `mint`, `quoteId`, `operationId`, `amount` | The melt was sent and the mint has not settled it either way. Pending, not failed.                                                                               | Record the payment as pending; the inputs stay `held` under the `melt` operation and `Melt.resumePending` settles it ([melt.md](./melt.md)). |
| `QuoteAlreadyIssued`        | `quoteId`, `mint`                          | `Topup.adopt`: the mint already issued this quote and no local operation claims it.                                                                              | Nothing to mint; another wallet holds the proofs.                                                                                            |
| `CounterLockTimeout`        | `mint`, `unit`, `keysetId`                 | Another tab/process held the counter lease too long. Transient. Nothing derived.                                                                                 | Retry; tell the user the wallet is busy elsewhere.                                                                                           |
| `MintInUse`                 | `mint`, `proofCount`                       | `Mints.removeKnownMint`: unspent proofs still name the mint.                                                                                                     | Spend or return them first ([mints.md](./mints.md)).                                                                                         |
| `OperationNotFound`         | `operationId`                              | No transfer with that id (a quote operation's id does not count as a transfer).                                                                                  | Refresh the list.                                                                                                                            |
| `InvalidTransferTransition` | `operationId`, `from`, `to`                | A `Tokens` transition the transfer's status forbids.                                                                                                             | Hide the action for that status ([tokens.md](./tokens.md)).                                                                                  |

The transient-versus-definitive rule behind the classification is in [concepts.md](./concepts.md#error-classification).

## Which operation fails how

Each vertical exports a union schema and type of the errors it can produce.

| Operation                                                                                          | Error type                                                       |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `Receive.receive`                                                                                  | `ReceiveError`                                                   |
| `Tokens.returnToWallet`                                                                            | `ReceiveError \| OperationNotFound \| InvalidTransferTransition` |
| `Tokens.markIssued`, `markExternalized`, `forget`                                                  | `OperationNotFound \| InvalidTransferTransition`                 |
| `Tokens.adoptToken`                                                                                | `TokenParseFailed`                                               |
| `Send.send`                                                                                        | `SendError`                                                      |
| `Melt.quote`, `Melt.melt`                                                                          | `MeltError`                                                      |
| `Melt.status`, `Topup.start`, `Mints.info`                                                         | `MintUnreachable \| MintRejected`                                |
| `TopupHandle.result`                                                                               | `TopupError`                                                     |
| `Topup.adopt`                                                                                      | `TopupAdoptError`                                                |
| `Autoswap.claim`                                                                                   | `AutoswapError`                                                  |
| `Autoswap.estimate`                                                                                | `AutoswapEstimateError`                                          |
| `FeeProbe.probeLightningFee`                                                                       | `FeeProbeError`                                                  |
| `Mints.removeKnownMint`                                                                            | `MintInUse`                                                      |
| `Validation.checkTransfer`                                                                         | `OperationNotFound`                                              |
| `Validation.checkAll`, `checkIssued`, `inspectProofStates`, `Restore.restore`, `restoreAndReclaim` | never; unreachable mints are data in the report                  |
| `Tokens.reclaim`, `importProofs`, `importOperation`, `ingestLegacyRows`                            | never                                                            |
| `Melt.resumePending`, `Topup.resumePending`, `Autoswap.resumePendingClaims`                        | never; each resumed result or handle carries its own outcome     |

Invalid input is not a package error. `new SendDraft({ … })` and `Schema.decodeUnknownSync(SendDraft)(…)` throw a `ParseError`; validate first with `Schema.decodeUnknownOption`, or wrap the decode in `Effect.suspend` so it becomes a defect that rejects the promise.

## Handling in Effect

`Effect.catchTag("TokenAlreadyKnown", (known) => …)` handles one tag and keeps the rest typed; `Effect.catchTags({ MintUnreachable: …, CounterLockTimeout: … })` handles several; `Effect.either` turns the outcome into a value at the Promise boundary, then switch on `outcome.left._tag` ([getting-started.md](./getting-started.md#first-run)).

## Serialization

Every error round-trips through JSON via `Schema.parseJson`, which is how operations carry their last failure in `error`: `Schema.encodeSync(Schema.parseJson(ReceiveError))(error)` yields `'{"_tag":"TokenAlreadySpent","mint":"https://mint.example"}'`, and `Schema.decodeUnknownOption(Schema.parseJson(ReceiveError))` reads it back. Receive writes a `ReceiveError` onto a failed receive or a send it could not return; Melt writes the `MintRejected` onto a melt it closed `failed`. Parse the JSON and read `_tag` when you only need to classify.

## Related

- [concepts.md](./concepts.md): the definitive-vs-transient rule, proof states, and operation statuses
- [inspector.md](./inspector.md): `OperationFailed` events carry the same tagged errors
