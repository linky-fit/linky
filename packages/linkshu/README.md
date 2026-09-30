# @linky-fit/linkshu

A cashu wallet as a typed [Effect](https://effect.website) library. Each wallet operation is a service that takes a draft and returns a receipt: receive a token, send an amount, pay a bolt11 invoice, top up over Lightning, move funds between mints, validate proofs, restore from seed. You bring the BIP-39 seed and three storage ports; the package owns the proof inventory, the operation records, the deterministic counters, and every state decision.

Raw cashu-ts types never cross the package boundary. Token text is the currency of the API: operations take and return `cashuA…`/`cashuB…` strings, never proof lists.

## Install

```bash
bun add @linky-fit/linkshu effect
# or: npm install @linky-fit/linkshu effect
```

ESM with TypeScript declarations, for Node 22.14+ and modern browser bundlers. Your code imports from `effect` directly, so install it alongside.

## Example

`runLinkshu` builds the services, runs one effect, and tears everything down. Without stores it uses non-durable in-memory defaults; a real wallet supplies its own ([ports](./docs/ports.md)).

```ts
import { Effect } from "effect";
import { Receive, ReceiveDraft, runLinkshu } from "@linky-fit/linkshu";

const receipt = await runLinkshu(
  { bip39Seed, keyValueStore, proofStore, operationStore },
  Effect.gen(function* () {
    const receive = yield* Receive;
    return yield* receive.receive(new ReceiveDraft({ text: scannedText }));
  }),
);
```

The receipt resolves only after the received proofs are persisted as `available`. A failure is a tagged error (`TokenAlreadyKnown`, `MintUnreachable`, …) you match on `_tag`.

## Documentation

The guides are in [`docs/`](./docs/README.md). Read [getting started](./docs/getting-started.md) first, then [concepts](./docs/concepts.md) for proof states, operation statuses, counters, and how interrupted operations resume. Each wallet operation has its own guide; [errors](./docs/errors.md) is the error catalogue.

Runtime-free helpers ship on the same entry: the token codec ([tokens](./docs/tokens.md)), bolt11 invoice preview, LNURL-pay/withdraw/auth, lightning-address parsing, and fiat rates ([lightning utilities](./docs/lightning-utilities.md)). `@linky-fit/linkshu/lightning-address` exports only the lightning-address helpers, for bundles that must not pull in cashu-ts or Effect.

## License

Zero-Clause BSD (0BSD). The `LICENSE` file ships in the package.
