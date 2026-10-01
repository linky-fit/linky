# Getting started

Wire `@linky-fit/linkshu` and make a first wallet call.

## Install

```bash
bun add @linky-fit/linkshu effect
```

The package ships ESM and TypeScript declarations for Node 22.14+ and modern browser bundlers. `@linky-fit/linkshu/lightning-address` is a second entry with only the lightning-address helpers ([lightning-utilities.md](./lightning-utilities.md)).

## First run

`runLinkshu` builds the services, runs your effect, and tears everything down. Without stores it uses in-memory defaults, so this needs no mint and no network:

```ts
import {
  Bip39Seed,
  Receive,
  ReceiveDraft,
  runLinkshu,
  Tokens,
} from "@linky-fit/linkshu";
import { Effect, Result } from "effect";

// Disposable seed: random bytes own nothing and are gone when the process exits.
const bip39Seed = Bip39Seed.make(crypto.getRandomValues(new Uint8Array(64)));

const program = Effect.gen(function* () {
  const tokens = yield* Tokens;
  const balances = yield* tokens.balances;
  console.log(
    `balance ${balances.total} sat across ${balances.perMint.length} mints`,
  );

  const receive = yield* Receive;
  const outcome = yield* Effect.result(
    receive.receive(new ReceiveDraft({ text: "not a cashu token" })),
  );
  if (Result.isFailure(outcome)) {
    console.log(`receive failed: ${outcome.failure._tag}`);
    return;
  }
  console.log(`received ${outcome.success.amount} ${outcome.success.unit}`);
});

await runLinkshu({ bip39Seed }, program);
```

Output:

```
balance 0 sat across 0 mints
receive failed: TokenParseFailed
```

`Effect.result` turned the typed failure into a value; without it the promise rejects with the error. Nothing was stored, because a parse failure never creates an operation.

## What you bring

`LinkshuServicesConfig` (and `LinkshuHeadlessConfig` for `runLinkshu`) takes `bip39Seed` plus optional `keyValueStore`, `proofStore`, and `operationStore` layers. The in-memory defaults lose everything when the runtime ends; a real consumer implements the ports ([ports.md](./ports.md)).

Build the seed on your side, for example with `mnemonicToSeedSync` from `@scure/bip39`, then `Bip39Seed.make(bytes)`. `Bip39Seed.make` throws unless the array is exactly 64 bytes. The package never sees the mnemonic.

## Long-lived: `linkshuServices` + `ManagedRuntime`

An app keeps one runtime alive. `linkshuServices(config)` returns the services layer; provide the inspector around it, because the services read it while the layer is built:

```ts
import { Inspector, linkshuServices, Tokens } from "@linky-fit/linkshu";
import type { LinkshuServicesConfig } from "@linky-fit/linkshu";
import { Effect, Layer, ManagedRuntime } from "effect";

export const makeWallet = (config: LinkshuServicesConfig) => {
  const runtime = ManagedRuntime.make(
    linkshuServices(config).pipe(Layer.provideMerge(Inspector.disabled)),
  );
  return {
    balances: () =>
      runtime.runPromise(Effect.flatMap(Tokens, (tokens) => tokens.balances)),
    dispose: () => runtime.dispose(),
  };
};
```

Rebuild the runtime when the seed changes and dispose the old one, with `Restore.wipeSeedBoundState` in between ([restore.md](./restore.md)). Topup handles poll inside a `Scope`; keep one long-lived scope next to the runtime and close it before `dispose` ([topup.md](./topup.md)). Run the resumers at startup ([concepts.md](./concepts.md#resuming-interrupted-operations)).

## Drafts from user input

`new SendDraft({...})` needs already-branded values. From plain strings and numbers, decode the whole draft; every field is validated at once and a bad one throws a `SchemaError`:

```ts
import { Send, SendDraft } from "@linky-fit/linkshu";
import { Effect, Schema } from "effect";

const decodeSendDraft = Schema.decodeUnknownSync(SendDraft);

export const sendFromForm = (mint: string, amount: number) =>
  Effect.suspend(() => {
    const draft = decodeSendDraft({ mint, amount, produceAs: "issued" });
    return Effect.flatMap(Send, (send) => send.send(draft));
  });
```

`Effect.suspend` keeps the throw inside the effect, so a bad form value rejects the promise like any other defect. Use `Schema.decodeUnknownOption` when you want to show the validation error instead.

From here, [concepts.md](./concepts.md) explains what the calls do to proofs and operations, and [the guide index](./README.md) lists one guide per operation.
