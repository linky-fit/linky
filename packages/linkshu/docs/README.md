# @linky/linkshu guides

How to use Linky's cashu wallet library. These are guides, not an API reference: the exported types are the reference, and the [package README](../README.md) holds the design rules and rationale.

## Where to start

1. [Getting started](./getting-started.md) — wire the seed and ports, run a first call, and learn the core concepts in one page. Read this first.
2. The guide for the operation you need, from the list below. Each one opens with a working example; jump to its Errors section when a call fails.

[Concepts](./concepts.md) is the lookup behind both: branded primitives, proof states and operation statuses, error classification, and a short Effect primer.

## Wallet operations

- [Receive](./receive.md) — from pasted or scanned text to `available` proofs
- [Send](./send.md) — swap an amount out into an encoded token
- [Melt](./melt.md) — pay a bolt11 invoice
- [Top up](./topup.md) — mint quote, invoice, settlement, and resuming interrupted topups
- [Autoswap](./autoswap.md) — move a foreign-mint balance to the main mint
- [Validation](./validation.md) — NUT-07 proof-state checks
- [Restore](./restore.md) — NUT-09 seed recovery and the seed-bound wipe
- [Tokens](./tokens.md) — read model, balances, send transitions, `returnToWallet`, backup import, legacy ingest, token codec
- [Mints](./mints.md) — mint info, fees, the known-mint set, icons
- [Fee probe](./fee-probe.md) — Lightning fee estimation via a melt quote
- [Lightning utilities](./lightning-utilities.md) — invoice preview, LNURL-pay/withdraw/auth, lightning addresses, fiat rates

## Integrating the package

- [Ports](./ports.md) — implementing `KeyValueStore`, `ProofStore`, `OperationStore`, and `CashuSeed` for a new platform
- [Errors](./errors.md) — every tagged error, when it happens, what to do
- [Inspector](./inspector.md) — diagnostics events and how to consume them
- [Testing](./testing.md) — in-memory ports, test helpers, the integration suite

## Finding your way

- Looking for a type or method name? Open `src/index.ts` and follow the export; every guide names the file it documents.
- Something behaves unexpectedly? The operation guide's "How it works" section states the persistence order and what survives an interruption; the [Errors](./errors.md) table says what each failure means.
- Want a working consumer to copy from? `apps/linkshu-cli` runs every operation on file-based ports; the web app's adapters are named in [Ports](./ports.md).
