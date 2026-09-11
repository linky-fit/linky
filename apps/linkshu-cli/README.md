# @linky/linkshu-cli

A cashu wallet in a terminal, and `@linky/linkshu`'s first consumer.

Its real job is to keep the package honest: it runs under plain Bun with no
browser, no React, and no Evolu, and every platform capability comes from the
three port implementations in `src/`. If linkshu ever reaches for a browser
API, this stops working.

```bash
bun run linkshu --help
bun run linkshu --data-dir /tmp/wallet topup 128
bun run linkshu --data-dir /tmp/wallet balance
```

Point it at a mint you can afford to lose money to. It defaults to the dev
stack's Nutshell FakeWallet mint, which pays its own invoices with fake sats:

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

Options: `--data-dir <path>`, `--mint <url>`, `--verbose`, `--help`.
`--verbose` prints every linkshu inspector event to stderr, so stdout stays the
command's result — `send` ends with the bare token, ready to pipe.

## Data directory

`--data-dir`, else `$LINKSHU_DATA_DIR`, else `~/.linkshu`. Four files:

- `seed.hex` — the 64-byte BIP-39 seed, generated on first use, mode `0600`
- `proofs.json` — the `ProofStore` rows (the wallet inventory), verbatim
- `operations.json` — the `OperationStore` rows (melts, topups, sends, …), verbatim
- `kv.json` — the `KeyValueStore` values and leases

A data directory written by a release before the proof inventory holds
`tokens.json` instead; it is not read. Recover such a wallet with `restore`
from its seed.

`$LINKSHU_SEED` (128 hex characters) overrides `seed.hex`, which is how you
restore a wiped wallet:

```bash
SEED=$(cat /tmp/wallet/seed.hex)
rm -rf /tmp/wallet
LINKSHU_SEED=$SEED bun run linkshu --data-dir /tmp/wallet restore
```

## Port implementations

All three are meant to be read as reference examples for the next platform.

**`jsonFile.ts`** is where the durability lives, and both stores sit on it.
`read` is a plain parse; `modify` is the only writer. A writer takes an
exclusive lock (`open(…, "wx")`, which fails rather than truncates when the
file exists), re-reads the freshest contents, and replaces the file with a
single `rename`. So a reader never sees a half-written file, and no writer can
overwrite another's update. A lock file whose mtime is older than 30s is
assumed to belong to a process that died holding it and gets broken; a lock
held live is waited on. Contents that exist but do not decode raise, because
silently starting over would look exactly like losing every token.

**`fileKeyValueStore.ts`** puts values and leases in one file, so acquiring a
lease and writing under it touch the same lock. The port's lease primitives
are deliberately dumb — retries and timeouts are linkshu's own semantics.

**`fileProofStore.ts`** and **`fileOperationStore.ts`** write JSON arrays of
the ports' own `StoredProof` / `StoredOperation` schemas, with ids derived by
`deriveStoreId` from the proof secret and the operation key. There is no
adapter mapping to drift, and the wallet stays readable in any text editor.

## Tests

`bun test` covers the ports and the argument parser, including a case that
spawns four processes writing the same file at once — the one that fails
without the lock. Nothing in the suite needs a mint; the wallet flows are
covered by `packages/linkshu`'s integration suite.
