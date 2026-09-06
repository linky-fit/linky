# Errors

Every failure linkshu reports, what it means, and how to handle it. You need this when writing the code that shows a wallet failure to a user, decides whether to retry, or stores the failure on a row.

## The catalogue

All errors are `Schema.TaggedError` classes from `src/domain/errors.ts` (plus `InvalidTokenTransition` from `src/token/domain.ts`). Branch on `_tag`; never string-match `detail`.

| Tag                      | Fields                          | When                                                                                                                       | Caller should                                                                                                                       |
| ------------------------ | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `TokenParseFailed`       | `reason`, `detail`              | No token in the text, or undecodable. `reason` is `empty`, `no-token-found`, `undecodable`, `no-proofs`, `multiple-mints`. | Tell the user the input is not a token. Nothing was stored.                                                                         |
| `TokenAlreadyKnown`      | `rowId`                         | A row (any state) already has this token text.                                                                             | Show "already in wallet"; link to `rowId`.                                                                                          |
| `TokenAlreadySpent`      | `mint`                          | The mint definitively reported the proofs spent (NUT-07 / code 11001).                                                     | Show "already spent". Receive persisted an `error` row for it.                                                                      |
| `MintUnreachable`        | `mint`, `detail`                | Network, timeout, 5xx. **Transient.**                                                                                      | Retry later. Recovery depends on when the failure occurred; an interrupted melt may leave `reserved` inputs ([melt.md](./melt.md)). |
| `MintRejected`           | `mint`, `code`, `detail`        | Definitive protocol rejection (`code` is the NUT error code when known).                                                   | Surface it; the flow already persisted whatever the rejection implies.                                                              |
| `InsufficientFunds`      | `mint`, `required`, `available` | Balance at `mint` cannot cover the amount (plus fee reserve for melt/autoswap).                                            | Offer a smaller amount or a top-up; `required`/`available` size the next attempt.                                                   |
| `QuoteExpired`           | `quoteId`, `mint`               | The mint says the quote expired before it settled.                                                                         | Start a fresh quote.                                                                                                                |
| `PaymentFailed`          | `mint`, `quoteId`, `detail`     | The mint accepted the melt but the Lightning payment did not settle.                                                       | Show failure; balance is intact (inputs may be `reserved` until validation).                                                        |
| `QuoteAlreadyIssued`     | `quoteId`, `mint`               | `Topup.adopt`: the mint already issued this quote and no local record claims it.                                           | Nothing to mint; another wallet holds the proofs.                                                                                   |
| `CounterLockTimeout`     | `mint`, `unit`, `keysetId`      | Another tab/process held the counter lease too long. **Transient.** Nothing derived.                                       | Retry. Web app copy: "Wallet is busy in another window".                                                                            |
| `TokenRowNotFound`       | `rowId`                         | A row id the store no longer has.                                                                                          | Refresh the list.                                                                                                                   |
| `InvalidTokenTransition` | `rowId`, `from`, `to`           | A `Tokens` transition the state machine forbids.                                                                           | Hide the action for that state; see the transition table in [concepts.md](./concepts.md).                                           |

## Which operation fails how

Each vertical exports a union type and schema of the errors it can produce.

| Operation                                             | Error type                                                                                   |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `Receive.receive`, `Tokens.returnToWallet`            | `ReceiveError` (+ `TokenRowNotFound`, `InvalidTokenTransition` for `returnToWallet`)         |
| `Send.send`                                           | `SendError`                                                                                  |
| `Melt.quote`, `Melt.melt`                             | `MeltError`                                                                                  |
| `Topup.start`                                         | `MintUnreachable \| MintRejected`                                                            |
| `TopupHandle.result`                                  | `TopupError`                                                                                 |
| `Topup.adopt`                                         | `TopupAdoptError`                                                                            |
| `Autoswap.claim`                                      | `AutoswapError`                                                                              |
| `FeeProbe.probeLightningFee`                          | `FeeProbeError`                                                                              |
| `Mints.info`                                          | `MintUnreachable \| MintRejected`                                                            |
| `Tokens.reserve`, `markIssued`, `markExternalized`    | `TokenRowNotFound \| InvalidTokenTransition`                                                 |
| `Validation.checkRow`                                 | `TokenRowNotFound`                                                                           |
| `Validation.checkAll`, `Restore.restore`              | never — unreachable mints are listed in the report's `unavailableMints`                      |
| `Validation.checkIssued`, `Tokens.deleteSpent`        | never — rows they cannot verify stay untouched; the report does not say which mints answered |
| `Topup.resumePending`, `Autoswap.resumePendingClaims` | never — each resumed handle or claim result carries its own outcome                          |

Invalid input is not a package error. `new SendDraft({ … })` and `Schema.decodeUnknownSync(SendDraft)(…)` throw a `ParseError`; validate first with `Schema.decodeUnknownOption`, or accept that it becomes a defect (the web app wraps the decode in `Effect.suspend` so a bad draft rejects the promise).

## Handling in Effect

Handle one tag and keep the rest typed:

```ts
import { Receive, ReceiveDraft } from "@linky/linkshu";
import { Effect } from "effect";

const receiveOrReuse = (text: string) =>
  Effect.flatMap(Receive, (receive) =>
    receive.receive(new ReceiveDraft({ text })),
  ).pipe(
    Effect.catchTag("TokenAlreadyKnown", (known) =>
      Effect.succeed({ rowId: known.rowId, duplicate: true as const }),
    ),
  );
```

Handle several tags at once — the classification rule in one place:

```ts
import type { ReceiveError } from "@linky/linkshu";
import { Effect } from "effect";

const withRetryHint = <A, R>(operation: Effect.Effect<A, ReceiveError, R>) =>
  operation.pipe(
    Effect.catchTags({
      MintUnreachable: () => Effect.fail("retry-later" as const),
      CounterLockTimeout: () => Effect.fail("retry-later" as const),
    }),
  );
```

Get the outcome as a value at the Promise boundary (what both real consumers do). One complete operation, run one-shot:

```ts
import { Bip39Seed, runLinkshu, Send, SendDraft } from "@linky/linkshu";
import { Effect, Either, Schema } from "effect";

const decodeSendDraft = Schema.decodeUnknownSync(SendDraft);

export const describeSend = async (
  bip39Seed: Bip39Seed,
  mint: string,
  amount: number,
): Promise<string> => {
  const outcome = await runLinkshu(
    { bip39Seed },
    Effect.either(
      Effect.suspend(() => {
        const draft = decodeSendDraft({ mint, amount, produceAs: "issued" });
        return Effect.flatMap(Send, (send) => send.send(draft));
      }),
    ),
  );
  if (Either.isLeft(outcome)) {
    switch (outcome.left._tag) {
      case "InsufficientFunds":
        return `need ${outcome.left.required}, have ${outcome.left.available}`;
      default:
        return outcome.left._tag;
    }
  }
  return `sent ${outcome.right.amount} ${outcome.right.unit}`;
};
```

The web app turns tags into display text in `apps/web-app/src/app/lib/cashuStoredError.ts` (`describeTaggedCashuError`). Extend that switch when you add an error; do not build another mapping.

## Serialization

Because every error is a `Schema.TaggedError`, it round-trips through JSON via `Schema.parseJson`. This is how rows carry their last failure in the `error` column:

```ts
import { MintUrl, ReceiveError, TokenAlreadySpent } from "@linky/linkshu";
import { Schema } from "effect";

const encodeReceiveError = Schema.encodeSync(Schema.parseJson(ReceiveError));
const decodeReceiveError = Schema.decodeUnknownOption(
  Schema.parseJson(ReceiveError),
);

const stored = encodeReceiveError(
  new TokenAlreadySpent({ mint: MintUrl.make("https://mint.example") }),
);
// '{"_tag":"TokenAlreadySpent","mint":"https://mint.example"}'
const back = decodeReceiveError(stored); // Option<ReceiveError>
```

Receive and Validation write exactly this shape. Read it back with the union schema of the vertical that wrote it, or parse the JSON and read `_tag` when you only need to classify.

## Related

- [concepts.md](./concepts.md) — the definitive-vs-transient rule and the transition table
- [receive.md](./receive.md), [send.md](./send.md), [melt.md](./melt.md), [topup.md](./topup.md) — where each error comes from
- [inspector.md](./inspector.md) — `OperationFailed` events carry the same tagged errors
