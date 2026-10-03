# Linky supporter service

The only device of Linky Bot, the identity that receives supporter payments. A long-running Bun process: it watches Linky Bot's gift-wrap inbox through linkstr, receives each cashu token with linkshu and answers the supporter with a result. It derives its Nostr key and cashu seed from `SUPPORTER_RECOVERY_SEED` with `@linky-fit/identity`, the same way the app does, and never sends the seed anywhere. No app or other device may ever log in with that seed: the app auto-receives tokens and would race the service.

## What it does

- At startup it publishes the Linky Bot profile, its relay lists (NIP-65 and NIP-17 inbox relays) and the five NIP-58 badge definitions (Bronze, Silver, Gold, Diamond and the generic supporter badge, images on `https://linky.fit/badges/`). Each is republished only when the relays do not already hold it as it is.
- A token message (`ChatMessageReceived` with a `TokenBody`) is a payment:
  1. Deduplicated on the SHA-256 of the token text, not on the rumor, because two devices of one sender can publish the same token. A known token with a stored result gets that result queued again unless it is still in the outbox or already delivered; nothing else happens.
  2. A token from a mint outside `SUPPORTER_ACCEPTED_MINTS`, in a unit other than sat, or unreadable is refused (`mint_not_accepted`, `invalid_token`) without receiving it.
  3. The payment is recorded as `receiving`, with the token text, before linkshu is called, so a crash or a failed receive resumes from the row.
  4. Receive. A spent token counts as received when linkshu holds a finished receive of it (the service received it before a crash), else it is refused `token_spent`. A token whose mint is down stays `deferred`; every minute the service runs `Receive.resumeDeferred` and finishes the payments whose receive completed. Any other unfinished receive is tried again every minute; a token the mint still rejects (`MintRejected`) 6 hours after it arrived is refused `invalid_token`.
  5. The tier comes from the token's amount before the mint's fee, so Linky pays the fees. Below Bronze the result is `thanks`; otherwise linkstr's `SupporterBadges.signAwards` signs the tiered and the generic award, dated now.
  6. The result is stored on the row (`ready`) and queued as a `supporterResult` outbox job whose ref names the token hash, so it is never queued twice. The outbox retries until a relay accepts the wrap, then the row becomes `delivered`.
- Text and file messages get one auto-reply per sender and UTC day of the service's clock pointing to the Linky contact. Payment notices are ignored.

Logs never contain the seed, keys, token text or award JSON, and pubkeys appear shortened.

## Storage

One SQLite file (`SUPPORTER_STORAGE_PATH`, WAL) holds linkshu's key-value store, proofs and operations, linkstr's outbox and inbox cursor, the `payments` table (token hash, sender, rumor id, token text, amount, tier, state, result JSON, timestamps) and the auto-reply log. If the volume is lost, `Restore` (NUT-09) from the seed recovers the proofs.

## Run

```bash
bun run --filter @linky-fit/supporter-service dev     # watch mode, reads the committed .env.development
bun run --filter @linky-fit/supporter-service test
bun run --filter @linky-fit/supporter-service typecheck
```

`bun run dev` already runs the service as the `supporter` container of `docker-compose.dev.yml`, so stop that container (`docker compose -f docker-compose.dev.yml stop supporter`) before running it in watch mode; two processes on one Linky Bot would race each other.

## Local development

`.env.development` carries a fixed dev-only recovery seed. Its npub, the dev Linky Bot, is `npub1yagmakxydfdeqpfeun3qryk8r38mrwp6apuyaf3j3qdupc5vkjhsjg0qg2`; it never holds real funds. The dev service uses only the local relay and accepts the local `cashu-mint` and `https://testnut.cashu.space`. The web app points at it through `VITE_LINKY_BOT_NPUB` and `VITE_SUPPORTER_ACCEPTED_MINTS`, in `apps/web-app/.env.development` for `bun run dev` and as build args of the e2e `web-app` image.

In compose the browser and the tokens it sends name the relay and the mint by their host-published ports (`ws://localhost:7777`, `http://localhost:3338`, or the per-checkout ports of `scripts/e2e.sh`), and a relay list may only name loopback `ws://` relays. The `dev` image target therefore runs `docker/forward-ports.sh`, which forwards each `SUPPORTER_FORWARD_PORTS` entry (`<port>=<service>:<port>`) from the container's localhost to the compose service, so the service uses exactly the URLs the browser uses. Production images (`runtime` target) contain no forwarding.

## Wallet commands

The wallet commands of `apps/linkshu-cli` run over the service's SQLite file. Inside the container:

```bash
docker compose exec supporter bun /app/index.js balance
docker compose exec supporter bun /app/index.js send 1000 [mint]
docker compose exec supporter bun /app/index.js melt lnbc1… [mint]
```

`[mint]` defaults to the mint holding the most sat. Moving funds off the service is manual for now.

## Environment

For a deployment, copy `.env.example` to `.env.production` and set `SUPPORTER_RECOVERY_SEED`. Optional: `SUPPORTER_PORT` (8788), `SUPPORTER_STORAGE_PATH`, `SUPPORTER_RELAYS` (default linkstr's `DEFAULT_NOSTR_RELAYS`), `SUPPORTER_ACCEPTED_MINTS` (default `SUPPORTER_ACCEPTED_MINTS` from `@linky-fit/supporter`) and `SUPPORTER_ALLOW_INSECURE_LOCALHOST_RELAYS=1` for a loopback `ws://` relay.

HTTP: `GET /health` for Docker and `GET /` for the build commit.

## Docker

```bash
docker build -f apps/supporter/Dockerfile --build-arg GIT_COMMIT_SHA="$(git rev-parse HEAD)" -t linky-supporter .
docker run --rm --env-file apps/supporter/.env.production -v linky_supporter_data:/data linky-supporter
```

`docker-compose.example.yml` is the same setup as a compose service, with `/data` mounted so SQLite survives upgrades.
