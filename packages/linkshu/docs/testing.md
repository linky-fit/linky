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

**One clean wallet per runtime.** Omit the stores from `runLinkshu` (or provide `inMemoryKeyValueStore`/`inMemoryTokenStore`) and each runtime starts empty:

```ts
import { Bip39Seed, runLinkshu, TokenStore } from "@linky/linkshu";
import { Effect } from "effect";

const rowsOfFreshWallet = () =>
  runLinkshu(
    { bip39Seed: Bip39Seed.make(crypto.getRandomValues(new Uint8Array(64))) },
    Effect.flatMap(TokenStore, (store) => store.loadAll),
  );
```

**A restart is two runtimes over one storage.** The plain in-memory layers give every runtime an empty wallet, so keep the store instances and wrap them in `Layer.succeed` — the recipe is under "durability across runtimes" in [ports.md](./ports.md). Reads after an interrupted flow go through `TokenStore.loadAll`: `Tokens.balances` counts `accepted` only, so a `pending` or `reserved` row left behind is invisible there.

**Adapters are tested against the port contract**, not against wallet flows: durability, lease ownership, immediate read-after-write visibility. The CLI's `apps/linkshu-cli/src/fileKeyValueStore.test.ts` includes a four-process lock race worth copying. If your ids derive from `originalTokenText`, also run the flows you care about against `deterministicIdTokenStore` (below) so the upsert semantics are exercised.

**Real flows need a real mint.** Consumer tests cannot substitute the mint client, so anything that swaps, melts, or mints runs against the Docker mints. Copy the helpers from the integration suite below; they are plain functions over cashu-ts and the public API.

## Testing package internals

`src/testing` holds package-internal fixtures. They are excluded from the app build and not exported from the index; import them by relative path from a test inside the package.

| Helper                          | File                           | For                                                                                                                                                                                      |
| ------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fakeWallet(overrides)`         | `fakeWallet.ts`                | A `LoadedWallet` whose every method rejects; override only what the test exercises.                                                                                                      |
| `proof(amount, secret)`         | `fakeWallet.ts`                | A NUT-00 proof on `KEYSET_HEX`, for building tokens with cashu-ts's `getEncodedToken`.                                                                                                   |
| `answerProofStates(stateOf)`    | `fakeWallet.ts`                | A `checkProofsStates` implementation answering `stateOf(secret)` (default `UNSPENT`) for every proof.                                                                                    |
| `recordingInspector()`          | `inspector.ts`                 | `{ events, layer }`; every emitted event lands in `events` in order.                                                                                                                     |
| `seedRow(text, state?, error?)` | `rows.ts`                      | Inserts `text` as its own original encoding into the `TokenStore` in the environment.                                                                                                    |
| `amountOf(row)`                 | `rows.ts`                      | The parsed amount of a stored row, or `undefined`.                                                                                                                                       |
| `freshStorage()`                | `storage.ts`                   | `{ kv, tokens }` service instances that outlive one runtime; a second runtime over them models a restart.                                                                                |
| `runOnTestClock(program, step)` | `clock.ts`                     | Forks `program` and keeps advancing `TestClock` by `step` until it finishes. Needs `TestContext.TestContext`.                                                                            |
| `deterministicIdTokenStore`     | `deterministicIdTokenStore.ts` | A `TokenStore` layer with the Evolu adapter's observable semantics: ids derived from `originalTokenText`, insert-as-upsert, soft delete. Run flows that could collide on ids against it. |

A unit harness for one vertical bypasses the network by providing the internal `WalletInstances` service with a fake wallet. The pattern from `src/receive/Receive.test.ts`:

```ts
import { Effect, Layer } from "effect";
import { WalletInstances } from "../mint/internal/WalletInstances";
import { inMemoryKeyValueStore } from "../ports/inMemoryKeyValueStore";
import { inMemoryTokenStore } from "../ports/inMemoryTokenStore";
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
      inMemoryTokenStore,
      inspector.layer,
    ),
  ),
);

const run = <A, E>(program: Effect.Effect<A, E, Receive>) =>
  Effect.runPromiseExit(program.pipe(Effect.provide(layer)));
```

`Service.DefaultWithoutDependencies` is the vertical's layer minus its `WalletInstances` dependency, which is what lets you substitute the fake. Assert on `inspector.events.map((event) => event._tag)` to check the lifecycle and counter movements a flow produced.

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

| Helper                       | For                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| `mintUrl`, `targetMintUrl`   | The two mints as `MintUrl`.                                                                             |
| `randomSeed()`               | A fresh `Bip39Seed` per run — counters live at the mint, so a reused seed starts inside a signed range. |
| `fundToken(amountSat)`       | Mints fresh sats with a plain cashu-ts wallet and returns token text to receive.                        |
| `fundProofs`, `tokenOf`      | The same in two steps, when the test needs the proofs.                                                  |
| `invoiceFor(amountSat)`      | A payable bolt11 invoice from the **target** mint.                                                      |
| `claimExternally(tokenText)` | Someone else spends the token at the mint.                                                              |
| `acceptedTotalOf(rows)`      | Sum of `accepted` rows.                                                                                 |
| `inputFee(proofCount)`       | `ceil(proofCount * 100 / 1000)`, the dev mint's input fee.                                              |
| `durableStorage()`           | In-memory stores plus `layers` that survive across `runLinkshu` calls — a process restart.              |
| `receiveOnce(seed, text)`    | One in-memory runtime: receive `text`, return the receipt and rows.                                     |

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

## Related

- [ports.md](./ports.md) — the contracts your adapter tests should cover
- [inspector.md](./inspector.md) — the events `recordingInspector` collects
- [getting-started.md](./getting-started.md) — `runLinkshu` for one-shot runs
