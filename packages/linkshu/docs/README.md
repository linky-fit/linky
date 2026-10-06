# @linky-fit/linkshu guides

The exported types are the reference; these guides say what to call and what each call guarantees.

## Reading order

1. [Getting started](./getting-started.md): wire the seed and ports, make a first call.
2. [Concepts](./concepts.md): proof states, operation statuses, counters, error classification, resuming interrupted operations.
3. The guide for the operation you need.

## Wallet operations

- [Receive](./receive.md): pasted or scanned text to `available` proofs
- [Send](./send.md): swap an amount out into an encoded token
- [Melt](./melt.md): pay a bolt11 invoice
- [Top up](./topup.md): mint quote, invoice, settlement
- [Autoswap](./autoswap.md): move a balance from one mint to another
- [Envelopes](./envelope.md): reserve an amount under a key, so devices sharing the seed pay it at most once
- [Validation](./validation.md): NUT-07 proof-state checks
- [Restore](./restore.md): NUT-09 seed recovery and the seed-bound wipe
- [Tokens](./tokens.md): balances, send transitions, `returnToWallet`, `reclaim`, backup import, token codec
- [Mints](./mints.md): mint info, the known-mint set, icons, Lightning fee probe
- [Lightning utilities](./lightning-utilities.md): invoice preview, LNURL-pay/withdraw/auth, lightning addresses, fiat rates
- [Payment requests](./payment-requests.md): NUT-18 `creqA…` requests, BIP-321 `bitcoin:` URIs, and taking a payment by Lightning or Cashu

## Integrating the package

- [Ports](./ports.md): implementing `KeyValueStore`, `ProofStore`, `OperationStore` and `CashuSeed`
- [Errors](./errors.md): every tagged error, when it happens, what to do
- [Inspector](./inspector.md): diagnostics events and how to consume them
- [Testing](./testing.md): testing code that uses the package
