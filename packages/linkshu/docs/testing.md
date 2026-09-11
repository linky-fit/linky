# Testing

How to test code that uses linkshu, and how the package tests itself. Consumers (an adapter, a CLI command, a wallet screen) need the first half; the second half is for changing the package.

## Two kinds of tests

| Suite       | Where                         | Mint                              | Run                                                |
| ----------- | ----------------------------- | --------------------------------- | -------------------------------------------------- |
| Unit        | `src/**/*.test.ts`            | `fakeWallet` (no network)         | `bun run --filter @linky/linkshu test`             |
| Integration | `tests/integration/*.test.ts` | Docker Nutshell mints :3338/:3339 | `bun run --filter @linky/linkshu test:integration` |

Both use vitest with globals (`describe`/`it`/`expect` without imports). Unit tests run in the root `bun run test`; the integration suite is separate and runs in CI as `linkshu-integration`.

## Testing a consumer

You have the public API and the in-memory ports; nothing else is exported for tests.

**One clean wallet per runtime.** Omit the stores from `runLinkshu` (or provide `inMemoryKeyValueStore`/`inMemoryProofStore`/`inMemoryOperationStore`) and each runtime starts empty:

```ts
import { Bip39Seed, ProofStore, runLinkshu } from "@linky/linkshu";
import { Effect } from "effect";

const proofsOfFreshWallet = () =>
  runLinkshu(
    { bip39Seed: Bip39Seed.make(crypto.getRandomValues(new Uint8Array(64))) },
    Effect.flatMap(ProofStore, (store) => store.loadAll),
  );
```

**A restart is two runtimes over one storage.** The plain in-memory layers give every runtime an empty wallet, so keep the store instances and wrap them in `Layer.succeed` — the recipe is under "durability across runtimes" in [ports.md](./ports.md). Reads after an interrupted flow go through `ProofStore.loadAll` and `OperationStore.loadAll`: `Tokens.balances` counts `available` only, so proofs left `held` or `handedOut` and a `pending` operation are invisible there.

**Adapters are tested against the port contract**, not against wallet flows: durability, lease ownership, immediate read-after-write visibility, and the id derivation (inserting a stored secret or operation key must land on the same row). The CLI's `fileKeyValueStore.test.ts`, `fileProofStore.test.ts`, and `fileOperationStore.test.ts` (`apps/linkshu-cli/src/`) cover all of it, including a four-process lock race worth copying.

**Real flows need a real mint.** Consumer tests cannot substitute the mint client, so anything that swaps, melts, or mints runs against the Docker mints. Copy the helpers from the integration suite below; they are plain functions over cashu-ts and the public API.

## Testing package internals

`src/testing` holds package-internal fixtures. They are excluded from the app build and not exported from the index; import them by relative path from a test inside the package.

| Helper                                                        | File            | For                                                                                                                   |
| ------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------- |
| `fakeWallet(overrides)`                                       | `fakeWallet.ts` | A `LoadedWallet` whose every method rejects; override only what the test exercises.                                   |
| `proof(amount, secret)`                                       | `fakeWallet.ts` | A NUT-00 proof on `KEYSET_HEX`, for building tokens with cashu-ts's `getEncodedToken`.                                |
| `answerProofStates(stateOf)`                                  | `fakeWallet.ts` | A `checkProofsStates` implementation answering `stateOf(secret)` (default `UNSPENT`) for every proof.                 |
| `recordingInspector()`                                        | `inspector.ts`  | `{ events, service, layer }`; every emitted event lands in `events` in order.                                         |
| `seedProofs(mint, proofs, state?, operationId?)`              | `inventory.ts`  | Stores cashu-ts proofs at `mint` in `state` (default `available`) through the `ProofStore` in the environment.        |
| `seedTransfer(kind, status, mint, tokenText, amount, error?)` | `inventory.ts`  | Stores a `send` or `receive` operation carrying `tokenText`; returns the `StoredOperation`.                           |
| `proofsIn(proofs, state)`, `amountIn(proofs, state)`          | `inventory.ts`  | Filter stored proofs by state; sum their amounts.                                                                     |
| `secretsOf(proofs)`                                           | `inventory.ts`  | Sorted secrets, for stable assertions.                                                                                |
| `freshStorage()`                                              | `storage.ts`    | `{ kv, proofs, operations }` service instances that outlive one runtime; a second runtime over them models a restart. |
| `runOnTestClock(program, step)`                               | `clock.ts`      | Forks `program` and keeps advancing `TestClock` by `step` until it finishes. Needs `TestContext.TestContext`.         |

A unit harness for one vertical bypasses the network by providing the internal `WalletInstances` service with a fake wallet. The pattern from `src/receive/Receive.test.ts`:

```ts
import { Effect, Layer } from "effect";
import { WalletInstances } from "../mint/internal/WalletInstances";
import { inMemoryKeyValueStore } from "../ports/inMemoryKeyValueStore";
import { inMemoryOperationStore } from "../ports/inMemoryOperationStore";
import { inMemoryProofStore } from "../ports/inMemoryProofStore";
import { fakeWallet, proof } from "../testing/fakeWallet";
import { recordingInspector } from "../testing/inspector";
import { Receive } from "../receive/Receive";

const wallet = fakeWallet({
  receive: () => Promise.resolve([proof(4, "rcv-a"), proof(1, "rcv-b")]),
});
const inspector = recordingInspector();

const layer = Receive.DefaultWithoutDependencies.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      Layer.succeed(
        WalletInstances,
        WalletInstances.make({ get: () => Effect.succeed(wallet) }),
      ),
      inMemoryKeyValueStore,
      inMemoryProofStore,
      inMemoryOperationStore,
      inspector.layer,
    ),
  ),
);

const run = <A, E>(program: Effect.Effect<A, E, Receive>) =>
  Effect.runPromiseExit(program.pipe(Effect.provide(layer)));
```

`Service.DefaultWithoutDependencies` is the vertical's layer minus its `WalletInstances` dependency, which is what lets you substitute the fake. Seed the inventory with `seedProofs`/`seedTransfer` inside the program, read it back through `ProofStore.loadAll`/`OperationStore.loadAll`, and assert on `inspector.events.map((event) => event._tag)` to check the proof, operation, and counter movements a flow produced.

Time-driven flows (topup polling, melt's pending wait) run under the Effect `TestClock`:

```ts
import { Effect, TestContext } from "effect";
import { runOnTestClock } from "../testing/clock";

const settleOnTestClock = <A, E>(program: Effect.Effect<A, E>) =>
  Effect.runPromise(
    runOnTestClock(Effect.either(program), "5 seconds").pipe(
      Effect.provide(TestContext.TestContext),
    ),
  );
```

## The integration suite

`tests/integration/*.test.ts` exercises the public API only, against two Nutshell FakeWallet mints from `docker-compose.dev.yml`:

```bash
docker compose -f docker-compose.dev.yml up -d --wait cashu-mint cashu-mint-target
bun run --filter @linky/linkshu test:integration
```

Override the mints with `LINKSHU_MINT_URL` (source, default `http://localhost:3338`) and `LINKSHU_TARGET_MINT_URL` (target, default `http://localhost:3339`). Test timeout is 30 s per case.

`tests/integration/helpers.ts`:

| Helper                           | For                                                                                                                    |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `mintUrl`, `targetMintUrl`       | The two mints as `MintUrl`.                                                                                            |
| `randomSeed()`                   | A fresh `Bip39Seed` per run — counters live at the mint, so a reused seed starts inside a signed range.                |
| `fundToken(amountSat)`           | Mints fresh sats with a plain cashu-ts wallet and returns token text to receive.                                       |
| `fundProofs`, `tokenOf`          | The same in two steps, when the test needs the proofs.                                                                 |
| `availableRowsOf(proofs)`        | Those proofs as `NewProof`s (`available`, no operation), to insert straight into a `ProofStore` as a synced balance.   |
| `toCashuProofs(proofs)`          | Stored proofs as cashu-ts proofs, for talking to a mint outside linkshu.                                               |
| `invoiceFor(amountSat)`          | A payable bolt11 invoice from the **target** mint.                                                                     |
| `claimExternally(tokenText)`     | Someone else spends the token at the mint.                                                                             |
| `availableTotalOf(proofs)`       | Sum of `available` proofs.                                                                                             |
| `pendingOperations(store, kind)` | The `pending` operations of one kind a resumer would still pick up.                                                    |
| `inputFee(proofCount)`           | `ceil(proofCount * 100 / 1000)`, the dev mint's input fee.                                                             |
| `durableStorage()`               | `{ kv, proofs, operations, layers }`: in-memory stores plus layers that survive across `runLinkshu` calls — a restart. |
| `receiveOnce(seed, text)`        | One in-memory runtime: receive `text`, return the receipt and the stored proofs.                                       |

A typical case, in a new file under `tests/integration/`:

```ts
import { Receive, ReceiveDraft, runLinkshu, Tokens } from "@linky/linkshu";
import { Effect } from "effect";
import { durableStorage, fundToken, randomSeed } from "./helpers";

it("accepts a funded token net of the input fee", async () => {
  const text = await fundToken(6);
  const balances = await runLinkshu(
    { bip39Seed: randomSeed(), ...durableStorage().layers },
    Effect.gen(function* () {
      yield* (yield* Receive).receive(new ReceiveDraft({ text }));
      return yield* (yield* Tokens).balances;
    }),
  );
  expect(balances.total).toBeLessThan(6);
});
```

## Gotchas

- **The dev mint is not fee-free.** It runs with `input_fee_ppk: 100`: every swap costs `ceil(inputs / 10)` sat. A received 6-sat token lands as 5. Use `inputFee(n)` in assertions instead of hard-coding.
- **Rate limits are off** (`MINT_RATE_LIMIT=FALSE`). Nutshell's defaults (60 req/min, 20 transactions/min) would 429 partway through a run; do not point the suite at a mint with limits on.
- **The source mint pays its own invoices.** FakeWallet settles every quote it issues, so a melt against a :3338 invoice races its own timer. Use `invoiceFor` (target mint) for anything that must be paid by a melt.
- **Fresh seed per run.** Use `randomSeed()` every time; a reused seed makes the first swap collide with outputs the mint already signed and turns the test into a collision-recovery test.
- **Spent proofs stay.** An assertion on `ProofStore.loadAll` after a spend sees the consumed inputs as `spent` rows, not gone; filter with `availableTotalOf` or by `state`.

## Related

- [ports.md](./ports.md) — the contracts your adapter tests should cover
- [inspector.md](./inspector.md) — the events `recordingInspector` collects
- [getting-started.md](./getting-started.md) — `runLinkshu` for one-shot runs
