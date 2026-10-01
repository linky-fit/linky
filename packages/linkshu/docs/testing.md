# Testing

How to test code that uses linkshu: an adapter, a CLI command, a wallet screen. You have the public API and the in-memory ports; nothing else is exported for tests.

## One clean wallet per runtime

Omit the stores from `runLinkshu` (or provide `inMemoryKeyValueStore`/`inMemoryProofStore`/`inMemoryOperationStore`) and each runtime starts empty:

```ts
import { Bip39Seed, ProofStore, runLinkshu } from "@linky-fit/linkshu";
import { Effect } from "effect";

const proofsOfFreshWallet = () =>
  runLinkshu(
    { bip39Seed: Bip39Seed.make(crypto.getRandomValues(new Uint8Array(64))) },
    Effect.flatMap(ProofStore, (store) => store.loadAll),
  );
```

## A restart is two runtimes over one storage

The in-memory layers give every runtime an empty wallet, so keep the store instances and wrap them in `Layer.succeed`; the recipe is under "durability across runtimes" in [ports.md](./ports.md). Read the state after an interrupted flow through `ProofStore.loadAll` and `OperationStore.loadAll`: `Tokens.balances` counts `available` only, so proofs left `held` or `handedOut` and a `pending` operation are invisible there.

## Adapters are tested against the port contract

Not against wallet flows. Cover durability across a reopen, lease ownership (one winner when several race a key, expired leases claimable, a renewed lease held past its first TTL, a foreign `LeaseId` cannot renew or release), immediate read-after-write visibility in `loadAll`, and the id derivation (inserting a stored secret or operation key lands on the same row). A multi-process lock race is worth a test of its own when your storage is shared between processes.

## Real flows need a real mint

Consumer tests cannot substitute the mint client, so anything that swaps, melts, or mints runs against a mint. A Nutshell mint with the FakeWallet backend in Docker works: it settles every invoice it issues, so a topup completes on its own, while a melt needs an invoice from a second mint to be a real payment. Turn its rate limits off, use a fresh seed per run (a reused seed collides with outputs the mint already signed), and compute expected amounts from its `input_fee_ppk` instead of hard-coding them (at 100 ppk a received 6-sat token lands as 5). Spent proofs stay as `spent` rows in `ProofStore.loadAll`; filter by `state`.

## Related

- [ports.md](./ports.md): the contracts your adapter tests should cover
- [inspector.md](./inspector.md): a callback inspector collects the events a flow emitted
