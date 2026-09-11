# @linky/linkshu

Linky's cashu wallet as a typed library. Every wallet operation the app
performs (receive a token, send an amount, pay an invoice, top up, validate,
restore, …) is defined here as an Effect service over branded `Schema` types.
Raw cashu-ts types never cross the package boundary: callers hand in drafts
and get receipts; token text is the currency of the API.

## Documentation

Usage guides live in [`docs/`](./docs/README.md): start with
[getting started](./docs/getting-started.md), then the guide for the
operation you need (receive, send, melt, top up, restore, …). This README
holds the design rules; the guides show how to call the package.

## Verticals

- `receive/` — one call from pasted/scanned text to `available` proofs:
  extraction, decoding, dedup by token text and by proof secret,
  deterministic re-signing with counter-collision recovery, and a `receive`
  operation that records the outcome so a failed paste can be retried
- `send/` — amount in, encoded token out: NUT-07 pre-filter, swap with
  disjoint send/keep counter blocks, the send proofs stored `handedOut` under
  a `send` operation and the change stored `available` before the consumed
  inputs are marked `spent`
- `melt/` — bolt11 payment: quote, fee-inclusive swap, NUT-08 blank-output
  accounting that advances the counter past the full blank range. The `melt`
  operation — quote, amounts, blank slot — is persisted and its inputs are
  `held` under it before the request leaves, so `resumePending` settles a
  payment the mint had not answered (change reclaimed via NUT-09, or inputs
  released) on the next run, on any device that syncs the stores
- `validation/` — NUT-07 proof-state checks: batched checkstate, per-proof
  spent marking, release of proofs held by an unknown operation, and
  handed-out sends closed once the recipient claims them
- `restore/` — NUT-09 recovery from seed across known mints and keysets,
  with cursor-windowed scanning and a deep fallback; also owns the
  seed-bound state wipe
- `topup/` — a self-recovering flow: mint quote out, invoice paid, proofs
  minted. The pending `topup` operation — including the counter slot a mint
  attempt reserved — is persisted before every network call that could
  strand funds, so `resumePending` finishes an interrupted topup on the next
  run: a lost mint response is reclaimed via NUT-09 rather than minted twice
- `autoswap/` — consolidate a foreign mint into the main mint: quote a
  topup at the target, melt the source balance against that invoice
  (stepping the amount down by the shortage the melt reports), then mint at
  the target. The `autoswap` operation is persisted before the invoice can be
  paid, so `resumePendingClaims` finishes an interrupted swap — off the same
  reserved counter slot, so it never mints twice
- `feeProbe/` — Lightning fee estimation via a real melt quote (NUT-06
  publishes none); nothing is paid and results cache per mint for a day
- `token/` — the one token codec (v3 JSON, v4 CBOR, legacy cashu.me JSON)
  plus `Tokens`: the read model (proofs, operations, transfers, balances),
  the send transitions, `returnToWallet` (a handed-out send is re-received so
  the old encoding dies at the mint; a failed receive is retried), `forget`,
  backup import, and `ingestLegacyRows` for the pre-inventory row model
- `mint/` — mint info (name, `input_fee_ppk`, MPP) and the known-mint set
  (stored proofs, operations, seen mints); internally the single
  wallet-instance cache every vertical shares

## Invoice previews

`getLightningInvoicePreview`, `parseBolt11AmountMsat`, and
`getLightningInvoiceDescriptionHashHex` are pure exports for displaying invoice
amounts, descriptions and expiry, and checking LNURL description hashes. They
need no wallet runtime. These preserve the app's permissive preview behavior;
they do not validate signatures or authorize payment.

## Proof inventory

The package owns the state machine; platforms persist proofs and operations,
never decide states. A proof is one row of the `ProofStore` in one of
`available`, `held`, `handedOut`, `externalized`, `spent` — only `available`
counts as balance, and `spent` is terminal and never deleted, so restore and
re-ingest dedup against it. An operation (`melt`, `topup`, `autoswap`,
`send`, `receive`) is the durable link between inputs and outputs; a proof
names the operation holding it through `operationId`. Dedup on receive is by
token text against stored transfers and by proof secret against the
inventory. Failures follow one classification rule everywhere: a proof is
marked `spent` only on the mint's own word (NUT-07, or code 11001);
transient failures (network, timeout, 5xx) never change a proof's state, and
an operation that failed carries its serialized error. Funds are never
outside the store: fresh proofs (change, remainders, minted and restored
proofs) are stored `available` before consumed inputs are marked `spent` and
before any receipt resolves.

## Ports

Platform capabilities come in as services the package defines; in-memory
defaults are exported so tests and experiments need no wiring.

- `KeyValueStore` — durable string storage **with lease-lock primitives**.
  Plain get/set is insufficient: deterministic counters must be advanced
  under cross-context mutual exclusion (tabs, service worker, CLI
  processes). The port stays dumb — acquisition retries, queueing, and
  timeouts are package semantics. It holds only device-local state:
  counters, leases, restore cursors, seen mints and keysets, the fee-probe
  cache.
- `ProofStore` — the dumb inventory (`insert`/`update`/`loadAll`). Every
  state decision is package logic. Ids MUST derive from the proof secret so
  every device stores one proof under one id; inserting a known secret is an
  upsert. Evolu specifics (owner lanes, the write overlay) live in the
  app-side adapter.
- `OperationStore` — the same for operations (`insert`/`update`/`loadAll`).
  Ids derive from `operationKeyOf` (kind and token text for a transfer, kind,
  mint, and quote id for a quote). Synced between devices, so any device can
  resume a pending quote off the recorded counter slot.
- `CashuSeed` — hands the package raw BIP-39 seed bytes. The package is the
  trust boundary the seed exists for; platforms never derive anything.
- `Inspector` — optional diagnostics bus (`orNoop` pattern, cloned from
  linkstr): accept/send/melt/quote/restore traffic, proof and operation
  changes, and counter movements become inspector rows when a composition
  root provides the layer. Costs nothing when absent. No event ever carries
  seed material or proof secrets.

Deliberately **not** abstracted (linkstr precedent): HTTP (cashu-ts talks to
mints directly), crypto primitives, and the clock (Effect's `Clock` is
already injectable).

## Rules

- **Environment-agnostic.** No React, no Evolu, no `window`/`localStorage`
  imports. `apps/linkshu-cli` — a terminal wallet on plain Bun, implementing
  all three storage ports over files — is the package's first consumer and
  keeps this honest.
- **No raw cashu-ts types in the public API.** The package pins and wraps
  cashu-ts v4 behind its own domain schema, so cashu-ts upgrades stay
  behind the boundary.
- **The package owns inventory semantics.** Every platform gets the same
  proof states, operation statuses, dedup, and error classification from its
  dumb stores.
- **Counters are sacred.** Deterministic counters advance only under the
  lease lock, never move backwards, and over-advance on ambiguity (blank
  outputs, collisions) — a gap costs a restore scan, a reuse costs a mint
  rejection loop.
- **A missing NUT-07 answer is never a guess.** A proof state the mint did
  not return is excluded from spending and restore. Validation changes only
  proofs the mint answered about. Pending proofs stay in their state for a
  later check, never treated as spent or offered to a swap.
- **Serializable errors.** All errors are `Schema.TaggedError`, so failures
  can be persisted on operations without ad-hoc stringification.
- **No dependency edge to `@linky/linkstr`** in either direction. linkstr's
  small internal token classifier is an accepted duplicate.
- **Deferred verticals are designed-around, not built:** LNURL/LN-address
  payment, npub.cash claim and mint-preference sync, and contact payment
  (the app composes a linkshu `send` receipt with linkstr delivery, and
  confirms it via the send's `pending` status). Nothing in this surface may
  preclude them.
- **Linky's needs win** every generality conflict; the package is not built
  for publication.

## Tests

Unit tests are colocated (`src/**/*.test.ts`) and run with
`bun run --filter @linky/linkshu test` (included in the root `bun run test`).
The integration suite in `tests/integration/` exercises the public API
against two dev-stack docker mints:

```bash
docker compose -f docker-compose.dev.yml up -d --wait cashu-mint cashu-mint-target
bun run --filter @linky/linkshu test:integration
```

CI runs it as the `linkshu-integration` job in `tests.yml`. Source and target
use separate keys and databases on :3338 and :3339. Override their URLs with
`LINKSHU_MINT_URL` and `LINKSHU_TARGET_MINT_URL`. Autoswap verifies source
proofs are spent and target proofs can be redeemed; FakeWallet simulates
Lightning settlement.

## Usage

Service assembly has one home: `linkshuServices(config)` layers every
vertical over the ports; the web app keeps a `ManagedRuntime` over it.
Non-React environments use the headless one-shot runner, which also takes the
optional `inspector` layer:

```ts
import { Effect } from "effect";
import { Receive, ReceiveDraft, runLinkshu } from "@linky/linkshu";

const receipt = await runLinkshu(
  { bip39Seed, keyValueStore, proofStore, operationStore },
  Effect.gen(function* () {
    const receive = yield* Receive;
    return yield* receive.receive(new ReceiveDraft({ text: scannedText }));
  }),
);
```
