# Errors

Every failure linkshu reports, what it means, and how to handle it. The operation guides list only their guide-specific tags and link here.

## The catalogue

All errors are `Schema.TaggedError` classes. Branch on `_tag`; never string-match `detail`.

| Tag                         | When                                                                                                                                                                          | Caller should                                                                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `TokenParseFailed`          | No token in the text, or undecodable; `reason` says which.                                                                                                                    | Tell the user the input is not a token. Nothing was stored.                                                                                  |
| `TokenAlreadyKnown`         | A send or a finished receive carries this text (`operationId` set), or its proofs are already in the inventory (`operationId` is the holding operation, or null for balance). | Show "already in wallet"; link to the transfer when there is one.                                                                            |
| `TokenAlreadySpent`         | The mint definitively reported the proofs spent (NUT-07 / code 11001).                                                                                                        | Show "already spent". A receive is `failed` only if the swap was rejected; a returned send closed `done` (the recipient claimed it).         |
| `MintUnreachable`           | Network, timeout, 5xx. Transient. From `Melt.melt` it means the request never left (no melt operation exists); a lost melt response is `PaymentPending` instead.              | Retry later; no proof changed state (a receive whose swap failed is left `failed` for the retry).                                            |
| `MintRejected`              | Definitive protocol rejection (`code` is the NUT error code when known), HTTP 4xx, or malformed mint data.                                                                    | Surface `detail`; the flow already persisted whatever the rejection implies.                                                                 |
| `InsufficientFunds`         | Confirmed-unspent balance at `mint` cannot cover the amount (plus fee reserve for melt and autoswap).                                                                         | Offer a smaller amount or a top-up; `required`/`available` size the next attempt.                                                            |
| `AmountConsumedByFee`       | The mint's input fee to swap the proofs (NUT-02) is at least their value; no swap or inventory change was attempted.                                                          | Tell the user the amount has to exceed `fee`.                                                                                                |
| `QuoteExpired`              | The mint says the quote expired before it settled.                                                                                                                            | Start a fresh quote.                                                                                                                         |
| `PaymentFailed`             | The mint reported the Lightning payment `UNPAID`, or the quote was not payable.                                                                                               | Show failure; balance is intact.                                                                                                             |
| `PaymentPending`            | The melt was sent and the mint has not settled it either way. Pending, not failed.                                                                                            | Record the payment as pending; the inputs stay `held` under the `melt` operation and `Melt.resumePending` settles it ([melt.md](./melt.md)). |
| `QuoteAlreadyIssued`        | `Topup.adopt`: the mint already issued this quote and no local operation claims it.                                                                                           | Nothing to mint; another wallet holds the proofs.                                                                                            |
| `CounterLockTimeout`        | Another tab/process held the counter lease, or the mint's receive lease (`keysetId` null), too long. Transient. Nothing derived.                                              | Retry; tell the user the wallet is busy elsewhere.                                                                                           |
| `MintInUse`                 | `Mints.removeKnownMint`: unspent proofs still name the mint.                                                                                                                  | Spend or return them first ([mints.md](./mints.md)).                                                                                         |
| `OperationNotFound`         | No transfer with that id (a quote operation's id does not count as a transfer).                                                                                               | Refresh the list.                                                                                                                            |
| `InvalidTransferTransition` | A `Tokens` transition the transfer's status forbids.                                                                                                                          | Hide the action for that status ([tokens.md](./tokens.md)).                                                                                  |

The transient-versus-definitive rule behind the classification is in [concepts.md](./concepts.md#error-classification).

## Which operations never fail

Each method's signature names its error union (`ReceiveError`, `SendError`, `MeltError`, `TopupError`, `TopupAdoptError`, `AutoswapError`, `AutoswapEstimateError`, `FeeProbeError`). The ones typed `never` report trouble as data instead:

- `Validation.checkAll`, `checkIssued`, `inspectProofStates`, `Restore.restore`, `restoreAndReclaim`: unreachable mints are listed in the report.
- `Tokens.reclaim`, `importProofs`, `importOperation`, `ingestLegacyRows`.
- `Melt.resumePending`, `Topup.resumePending`, `Autoswap.resumePendingClaims`: each resumed result or handle carries its own outcome.

Invalid input is not a package error. `new SendDraft({ ... })` and `Schema.decodeUnknownSync(SendDraft)(...)` throw a `ParseError`; validate first with `Schema.decodeUnknownOption`, or wrap the decode in `Effect.suspend` so it becomes a defect that rejects the promise ([getting-started.md](./getting-started.md#drafts-from-user-input)).

## Serialization

Every error round-trips through JSON via `Schema.parseJson`, which is how operations carry their last failure in `error`: `Schema.encodeSync(Schema.parseJson(ReceiveError))(error)` yields `'{"_tag":"TokenAlreadySpent","mint":"https://mint.example"}'`, and `Schema.decodeUnknownOption(Schema.parseJson(ReceiveError))` reads it back. Receive writes a `ReceiveError` onto a failed receive or a send it could not return; Melt writes the `MintRejected` onto a melt it closed `failed`. Parse the JSON and read `_tag` when you only need to classify. `OperationFailed` inspector events carry the same tagged errors ([inspector.md](./inspector.md)).
