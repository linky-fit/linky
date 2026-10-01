# @linky-fit/linkshu-cli

A cashu wallet in a terminal, and `@linky-fit/linkshu`'s first consumer. It runs under plain Bun with no browser, React or Evolu; the three port implementations in `src/` supply everything platform-specific.

```bash
bun run linkshu --help
bun run linkshu --data-dir /tmp/wallet topup 128
bun run linkshu --data-dir /tmp/wallet balance
```

Point it at a mint you can afford to lose money to. It defaults to the dev stack's FakeWallet mint, which pays its own invoices with fake sats:

```bash
docker compose -f docker-compose.dev.yml up -d --wait cashu-mint
```

## Commands

| command           | what it does                                              |
| ----------------- | --------------------------------------------------------- |
| `balance`         | available balance held in the data directory              |
| `topup <amount>`  | mint quote for `<amount>` sat, then wait for it to settle |
| `topup`           | finish topups an earlier run left pending                 |
| `receive <token>` | accept a cashu token                                      |
| `send <amount>`   | swap out `<amount>` sat and print the token               |
| `melt <invoice>`  | pay a bolt11 invoice                                      |
| `melt`            | settle melts an earlier run left pending                  |
| `restore`         | recover the wallet from the seed via NUT-09               |

Options: `--data-dir <path>`, `--mint <url>`, `--verbose`, `--help`. `--verbose` prints linkshu inspector events to stderr, so stdout stays the command's result: `send` ends with the bare token, ready to pipe.

## Data directory

`--data-dir`, else `$LINKSHU_DATA_DIR`, else `~/.linkshu`. Four files:

- `seed.hex`: the 64-byte BIP-39 seed, generated on first use, mode `0600`
- `proofs.json`: the `ProofStore` rows
- `operations.json`: the `OperationStore` rows
- `kv.json`: the `KeyValueStore` values and leases

`$LINKSHU_SEED` (128 hex characters) overrides `seed.hex`, which is how you restore a wiped wallet:

```bash
SEED=$(cat /tmp/wallet/seed.hex)
rm -rf /tmp/wallet
LINKSHU_SEED=$SEED bun run linkshu --data-dir /tmp/wallet restore
```

## Port implementations

`fileKeyValueStore.ts`, `fileProofStore.ts` and `fileOperationStore.ts` are reference ports for the next platform. All three sit on `jsonFile.ts`, which holds the durability: a lock file, a re-read under the lock and an atomic rename, so concurrent processes never lose an update or read a half-written file. The files are plain JSON, readable in any editor. An undecodable file is an error, never a reset: a silent reset is indistinguishable from losing every token.

## Tests

`bun test` covers the ports and the argument parser, including four processes writing one file at once. Nothing here needs a mint; `packages/linkshu`'s integration suite covers the wallet flows.
