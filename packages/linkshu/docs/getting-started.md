# Getting started

Wire `@linky/linkshu` and make a first wallet call. Read this before touching cashu code in the web app, the CLI, or a script.

## What it is

`@linky/linkshu` is Linky's cashu wallet as an Effect library. Every wallet operation (receive, send, pay an invoice, top up, validate, restore, …) is a typed service that takes a draft and returns a receipt. You bring the seed and three storage ports; the package owns everything else, including the proof inventory and the deterministic counters.

## Core concepts

[concepts.md](./concepts.md) goes deeper on each.

- **Services.** Each operation is an Effect service (`Receive`, `Send`, `Melt`, `Topup`, …). `yield* Receive` gives you the instance; call a method on it.
- **Drafts in, receipts out.** Methods take a draft (`ReceiveDraft`, `SendDraft`, …) and return a receipt (`ReceiveReceipt`, `SendReceipt`, …). Both are typed over branded primitives (`MintUrl`, `Amount`, `TokenText`), so a plain string or number does not type-check until you decode it.
- **Proofs and operations.** The wallet is an inventory of proofs in your `ProofStore`, each in a state; only `available` counts as balance. Every flow that moves proofs (a melt, a topup, a send, …) is an operation in your `OperationStore`, and proofs point at the operation holding them. The package decides every state; your stores only persist it.
- **Ports.** You supply storage (`KeyValueStore`, `ProofStore`, `OperationStore`) and the seed. In-memory defaults exist for tests. The package talks to mints itself.
- **Errors are values.** Every failure is a tagged error (`MintRejected`, `MintUnreachable`, `InsufficientFunds`, …) you match on `_tag`.

## Install and import

Add the workspace dependency and import from the package root:

```json
{ "dependencies": { "@linky/linkshu": "workspace:*", "effect": "^3.19.19" } }
```

```ts
import { Receive, ReceiveDraft, runLinkshu } from "@linky/linkshu";
import { Effect } from "effect";
```

`@linky/linkshu/lightning-address` is a second entry for the lightning-address helpers; see [lightning-utilities.md](./lightning-utilities.md).

## First run

`runLinkshu` builds the services, runs your effect, and tears everything down. With no ports given it uses in-memory stores, so this needs no mint, no network, and no setup. Save it as `first-run.ts` next to a `package.json` that lists the dependency (for example in `apps/linkshu-cli/`):

```ts
import {
  Bip39Seed,
  Receive,
  ReceiveDraft,
  runLinkshu,
  Tokens,
} from "@linky/linkshu";
import { Effect, Either } from "effect";

// Disposable seed: random bytes own nothing and are gone when the process exits.
const bip39Seed = Bip39Seed.make(crypto.getRandomValues(new Uint8Array(64)));

const program = Effect.gen(function* () {
  const tokens = yield* Tokens;
  const balances = yield* tokens.balances;
  console.log(
    `balance ${balances.total} sat across ${balances.perMint.length} mints`,
  );

  const receive = yield* Receive;
  const outcome = yield* Effect.either(
    receive.receive(new ReceiveDraft({ text: "not a cashu token" })),
  );
  if (Either.isLeft(outcome)) {
    const failure = outcome.left;
    console.log(
      failure._tag === "TokenParseFailed"
        ? `no token in input (${failure.reason})`
        : `receive failed: ${failure._tag}`,
    );
    return;
  }
  console.log(`received ${outcome.right.amount} ${outcome.right.unit}`);
});

await runLinkshu({ bip39Seed }, program);
```

```bash
bun run first-run.ts
```

Expected output:

```
balance 0 sat across 0 mints
no token in input (no-token-found)
```

What happened: `Tokens.balances` read an empty inventory, and `Receive.receive` failed with `TokenParseFailed`. `Effect.either` turned that typed failure into a value; without it the promise rejects with the error. Nothing was stored, because a parse failure never creates an operation.

To put real funds in, paste a token: [receive.md](./receive.md). Or mint some against the local Docker mint: [topup.md](./topup.md).

## The four inputs you bring

| Input            | Type                          | What it is                                                                                                   |
| ---------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `bip39Seed`      | `Bip39Seed`                   | The raw 64-byte BIP-39 seed. All deterministic derivation hangs off it; the package never sees the mnemonic. |
| `keyValueStore`  | `Layer.Layer<KeyValueStore>`  | Durable string storage with lease locks; device-local state only. Optional: in-memory default.               |
| `proofStore`     | `Layer.Layer<ProofStore>`     | The proof inventory. Optional: in-memory default.                                                            |
| `operationStore` | `Layer.Layer<OperationStore>` | The operation records. Optional: in-memory default.                                                          |

The in-memory defaults lose everything when the runtime ends. A real consumer implements the ports ([ports.md](./ports.md)); the CLI's file-based ones are the shortest working set.

Build the seed from a mnemonic on your side with `mnemonicToSeedSync` from `@scure/bip39`, then `Bip39Seed.make(bytes)`. `Bip39Seed.make` throws unless the array is exactly 64 bytes. The web app does this in `apps/web-app/src/platform/linkshu/resolveLinkshuSeed.ts`.

## Long-lived: `linkshuServices` + `ManagedRuntime`

An app keeps one runtime alive for the wallet UI. `linkshuServices` returns the layer; the inspector must be provided _around_ it, because the services read it while the layer is built. `config` carries your seed and the storage layers from [ports.md](./ports.md):

```ts
import {
  Inspector,
  linkshuServices,
  Receive,
  ReceiveDraft,
  Tokens,
} from "@linky/linkshu";
import type { LinkshuServicesConfig } from "@linky/linkshu";
import { Effect, Layer, ManagedRuntime } from "effect";

export const makeWallet = (config: LinkshuServicesConfig) => {
  const runtime = ManagedRuntime.make(
    linkshuServices(config).pipe(Layer.provideMerge(Inspector.disabled)),
  );
  return {
    balances: () =>
      runtime.runPromise(Effect.flatMap(Tokens, (tokens) => tokens.balances)),
    receive: (text: string) =>
      runtime.runPromise(
        Effect.either(
          Effect.flatMap(Receive, (receive) =>
            receive.receive(new ReceiveDraft({ text })),
          ),
        ),
      ),
    dispose: () => runtime.dispose(),
  };
};
```

Rebuild the runtime when the seed changes and dispose the old one. Topup handles poll in a `Scope`; keep one long-lived scope next to the runtime and close it before `dispose` — see [topup.md](./topup.md). The web app's version is `apps/web-app/src/app/hooks/composition/useLinkshuComposition.ts`.

## Drafts from user input

`new SendDraft({...})` needs already-branded values. From plain strings and numbers, decode the whole draft instead; every field is validated at once and a bad one throws a `ParseError`:

```ts
import { Send, SendDraft } from "@linky/linkshu";
import { Effect, Schema } from "effect";

const decodeSendDraft = Schema.decodeUnknownSync(SendDraft);

export const sendFromForm = (mint: string, amount: number) =>
  Effect.suspend(() => {
    const draft = decodeSendDraft({ mint, amount, produceAs: "issued" });
    return Effect.flatMap(Send, (send) => send.send(draft));
  });
```

`Effect.suspend` keeps the throw inside the effect, so a bad form value rejects the promise like any other defect. Validate first with `Schema.decodeUnknownOption` when you want to show the error instead.

## The services

| Service      | Methods                                                                                                                                                              | Guide                            |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `Receive`    | `receive`                                                                                                                                                            | [receive.md](./receive.md)       |
| `Send`       | `send`                                                                                                                                                               | [send.md](./send.md)             |
| `Melt`       | `quote`, `melt`, `status`, `resumePending`                                                                                                                           | [melt.md](./melt.md)             |
| `Topup`      | `start`, `adopt`, `resumePending`                                                                                                                                    | [topup.md](./topup.md)           |
| `Autoswap`   | `claim`, `resumePendingClaims`                                                                                                                                       | [autoswap.md](./autoswap.md)     |
| `Validation` | `checkAll`, `checkTransfer`, `checkIssued`, `inspectProofStates`                                                                                                     | [validation.md](./validation.md) |
| `Restore`    | `restore`, `wipeSeedBoundState`                                                                                                                                      | [restore.md](./restore.md)       |
| `Tokens`     | `proofs`, `operations`, `transfers`, `balances`, `markIssued`, `markExternalized`, `forget`, `returnToWallet`, `importProofs`, `importOperation`, `ingestLegacyRows` | [tokens.md](./tokens.md)         |
| `Mints`      | `info`, `knownMints`, `addKnownMint`, `removeKnownMint`                                                                                                              | [mints.md](./mints.md)           |
| `FeeProbe`   | `probeLightningFee`                                                                                                                                                  | [fee-probe.md](./fee-probe.md)   |

Helpers that need no runtime (token codec, invoice preview, LNURL) are in [tokens.md](./tokens.md) and [lightning-utilities.md](./lightning-utilities.md).

## Next: a funded wallet

`apps/linkshu-cli` is a complete consumer on file-based ports. Run it against the local mint to see a top-up land as balance (needs Docker):

```bash
docker compose -f docker-compose.dev.yml up -d --wait cashu-mint
bun run linkshu --data-dir /tmp/wallet topup 128
bun run linkshu --data-dir /tmp/wallet --verbose balance
```

`--verbose` prints every inspector event to stderr; [inspector.md](./inspector.md) explains them.

## Related

- [concepts.md](./concepts.md) — drafts, receipts, primitives, proof states, operation statuses, counters, Effect primer
- [ports.md](./ports.md) — implementing `KeyValueStore`, `ProofStore`, `OperationStore`, `CashuSeed`
- [errors.md](./errors.md) — every tagged error and how to handle it
- [inspector.md](./inspector.md) — diagnostics events
- [testing.md](./testing.md) — unit and integration testing
