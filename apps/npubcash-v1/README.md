# npub.cash v1 compatibility service

Temporary Bun service that keeps old Linky apps working once `npub.linky.fit` runs unmodified upstream npubcash-server v3 (phase 1 of [#694](https://github.com/linky-fit/linky/issues/694)). The proxy sends `npub.linky.fit/api/v1/*` here and everything else to v3. It shares v3's Postgres database; its only own table is `v1_claims`, unique on `(mint_url, quote_id)`.

While it runs, Linky infrastructure holds proofs for users, against the usual rule that quote ids and proofs go straight from the wallet to the mint. That ends when release N moves every account to v2 and this service shuts down (phase 4).

## Worker

Every `NPUBCASH_V1_WORKER_INTERVAL_MS` (5 s) it:

1. resumes every `minting` claim: restores its outputs with NUT-09, and mints again only while the mint reports the quote `PAID`;
2. takes up to 20 of v3's `PAID`, unlocked `sat` quotes with no claim, soonest expiry first, inserts a `minting` claim and mints it on the quote's own mint;
3. mints `unpaid` username fee claims whose quote the mint now reports `PAID`, and drops those whose unpaid quote expired.

Each output's secret and blinding factor come from `NPUBCASH_V1_SEED` with separate HMAC domains over `mint_url`, `quote_id` and the output index, with no keyset id, so a keyset rotation cannot strand them. A crash between the mint call and the database write therefore loses nothing: the next tick restores the same outputs. The proofs and v3's `ISSUED` state are written in one transaction.

A claim ends as `ready` (holds proofs), `spent`, `issued_elsewhere` (the mint reports `ISSUED` and a restore finds nothing) or `expired` (the mint refused a paid quote past its expiry with error 20007; it keeps its outputs for a manual retry). On a mint without NUT-09 the worker still mints, but a crash mid-mint loses that claim.

## Endpoints

All take NIP-98 checked against `X-Forwarded-Proto` + `Host` + path, as the fork did; the signed payload hash is not checked.

- `GET /api/v1/claim` returns the caller's unspent proofs (NUT-07), one token per mint, in the fork's `{error:false,data:{token,tokens,count}}` shape. It calls no mint other than NUT-07. A claim becomes `spent` only when the mint reports all its proofs spent.
- `GET /api/v1/info` returns `username`, `npub` and `mintUrl`, falling back to `NPUBCASH_V1_MINT_URL` for a caller with no account.
- `PUT /api/v1/info/mint` stores the default mint in v3's `l_users`.
- `PUT /api/v1/info/username` runs the fork's two-step purchase. Without `paymentToken` it creates a fee quote at `NPUBCASH_V1_MINT_URL` (5,000 sat, `satoshi` 1,000,000), stores an `unpaid` claim owned by `NPUBCASH_V1_OPERATOR_PUBKEY` and answers `402` with the invoice and a JWT. With it, it verifies the JWT (caller, name and price must match), mints the fee inline and sets the name only once the fee claim holds proofs. Error messages are the fork's, because old apps match them.

`GET /health` checks the database and reports the build commit.

## Environment

See `.env.example`. `NPUBCASH_V1_SEED` must be backed up like a wallet seed and kept until `v1_claims` is empty. `NPUBCASH_V1_JWT_SECRET` and `NPUBCASH_V1_MINT_URL` are the fork's `JWT_SECRET` and `MINTURL`, verbatim, so payment tokens and fees the fork issued still match.

## Cutover

`cutover.js`, built into the image next to `index.js`, copies the fork's database into v3's once (phase 2 of #694):

- `l_users` into v3's `l_users`, names lowercased; a user without a mint gets `NPUBCASH_V1_MINT_URL`.
- Unfulfilled `l_transactions` into `mint_quotes` as `UNPAID`, owner mapped from the npub or name to a hex pubkey. `expires_at` is a day past the invoice's expiry: v3 checks an expired `UNPAID` quote once more before giving up, and nobody can pay an expired invoice.
- `ready` and `inflight` `l_claims_3` rows into `ready` claims, one per transaction, keyed by its quote id (`fork:<transaction>` without one, `fork-claim:<id>` without a transaction). `spent` rows are skipped: the fork sets it only when the mint reports the proofs spent.
- `l_service_revenue_claims` into `ready` claims owned by `NPUBCASH_V1_OPERATOR_PUBKEY` at `NPUBCASH_V1_MINT_URL`, one per quote, so fork-issued payment tokens whose fee was collected still set their name.

Proofs keep only `id`, `amount`, `secret` and `C`.

Modes:

- `plan` prints what `apply` would copy and every problem (unresolved owner, name v3 rejects, name clash, unreadable invoice, unknown claim status). Read-only.
- `audit` runs `plan`, then asks the mints for each quote's state, the unspent value of the imported proofs, and whether their keysets are still listed. Read-only.
- `apply` writes everything in one transaction. It refuses when the plan has problems, when anything else is connected to either database (stop the fork, v3 and this service first), or when v3's database already holds users, quotes or claims.

It takes this service's environment plus `NPUBCASH_FORK_DATABASE_URL`:

```bash
docker compose run --rm --no-deps -e NPUBCASH_FORK_DATABASE_URL=postgres://… npubcash-v1 bun /app/cutover.js plan
bun run --filter @linky-fit/npubcash-v1 cutover plan   # from a checkout
```

## Run and test

```bash
bun run --filter @linky-fit/npubcash-v1 dev     # needs the env above
bun run --filter @linky-fit/npubcash-v1 test    # unit tests
docker compose -f docker-compose.dev.yml up -d --wait cashu-mint
NPUBCASH_V1_TEST_DATABASE_URL=postgres://... bun run --filter @linky-fit/npubcash-v1 test:integration
```

The integration tests create and drop their own databases on that Postgres server. The service tests also need the dev-stack nutshell mint; the cutover tests need only Postgres.

```bash
docker build -f apps/npubcash-v1/Dockerfile --build-arg GIT_COMMIT_SHA="$(git rev-parse HEAD)" -t linky-npubcash-v1 .
```
