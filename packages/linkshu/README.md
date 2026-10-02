# @linky-fit/linkshu

A cashu wallet as a typed [Effect](https://effect.website) library. Each wallet operation is a service that takes a draft and returns a receipt: receive a token, send an amount, pay a bolt11 invoice, top up over Lightning, move funds between mints, reserve an amount under a key that devices sharing the seed pay at most once, validate proofs, restore from seed. You bring a BIP-39 seed and three storage ports; the package decides every proof and operation state change.

Operations take and return token text (`cashuA…`/`cashuB…`), never proof lists. Raw cashu-ts types never cross the package boundary.

## Install

```bash
bun add @linky-fit/linkshu effect
# or: npm install @linky-fit/linkshu effect
```

ESM with TypeScript declarations, for Node 22.14+ and browser bundlers. Your code imports from `effect` directly, so install it too.

## Example

`runLinkshu` builds the services, runs one effect and tears everything down. Without stores it runs on non-durable in-memory defaults; a real wallet supplies its own ([ports](./docs/ports.md)).

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

Guides are in [`docs/`](./docs/README.md); start with [getting started](./docs/getting-started.md).

The token codec, bolt11 invoice preview, LNURL helpers, lightning-address parsing and fiat rates need no wallet runtime ([tokens](./docs/tokens.md), [lightning utilities](./docs/lightning-utilities.md)). `@linky-fit/linkshu/lightning-address` exports only the lightning-address helpers, with no dependency on cashu-ts or Effect.

## License

0BSD. The `LICENSE` file ships in the package.
