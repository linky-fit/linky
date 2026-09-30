# Linky Push Service

Bun HTTP service that delivers Web Push and Android FCM notifications for new outer NIP-17 inbox events (`kind: 1059`).

A client proves it owns a recipient pubkey by signing a short-lived challenge (`POST /auth/challenge`, then `POST /subscribe` or `POST /native/subscribe` with one proof per pubkey; `/unsubscribe` and `/native/unsubscribe` remove pubkeys the same way). Subscriptions, native tokens and challenges live in SQLite. The service watches the configured relays through linkstr's identity-free `PushInbox` and sends a generic notification to every subscribed recipient of a push-marked `1059` event; the title carries a shortened npub so a device subscribed for several identities can tell them apart, the body is fixed text. It never decrypts inbox events. Subscriptions that a provider reports as gone (`404`, `410`, VAPID mismatch, unregistered FCM token) are deleted. `GET /vapid-public-key`, `GET /health` and `GET /` (build commit SHA, from `BUILD_COMMIT_SHA`) complete the surface; request and response shapes are in `src/`.

## Environment

Copy `.env.example`. Required:

- `PUSH_VAPID_SUBJECT`, `PUSH_VAPID_PUBLIC_KEY`, `PUSH_VAPID_PRIVATE_KEY` (generate with `bunx web-push generate-vapid-keys`)
- `PUSH_FIREBASE_SERVICE_ACCOUNT_JSON` for Android: a single-line service account JSON with `project_id`, `client_email` and `private_key`; without it native subscribe answers `503 native_push_unavailable`

Optional: `PUSH_PORT`, `PUSH_STORAGE_PATH`, `PUSH_DEFAULT_RELAYS`, `PUSH_CORS_ORIGIN` (`*` or a comma-separated origin list), challenge TTL, proof age window, rate limits and subscription caps; `.env.example` lists them.

`PUSH_TRUSTED_PROXY_IPS` is a comma-separated list of the exact peer IPs of proxies you control, empty by default. For a trusted peer the server walks `X-Forwarded-For` from right to left and stops at the first untrusted address, so the proxy must append or replace the header. Without it, every client behind a proxy shares the proxy's rate-limit bucket. Behind a host proxy forwarding into Docker, the peer the container sees may be the bridge gateway, not `127.0.0.1`.

Delivery only accepts HTTPS endpoints on port 443 with a public DNS hostname; it resolves and checks every address, pins the connection to them, refuses redirects, caps provider responses at 16 KiB and gives up after 12 seconds. Request bodies are capped at 64 KiB. Logs omit client IPs, pubkeys and provider response bodies.

## Run

```bash
bun install
bun run --filter @linky-fit/push dev        # watch mode
bun run --filter @linky-fit/push start      # once
bun run --filter @linky-fit/push typecheck
```

## Docker

```bash
docker build -f apps/push/Dockerfile --build-arg GIT_COMMIT_SHA="$(git rev-parse HEAD)" -t linky-push .
cp apps/push/.env.production.example apps/push/.env.production   # fill in the values
docker run --rm -p 8787:8787 --env-file apps/push/.env.production \
  -e PUSH_STORAGE_PATH=/data/linky-push.sqlite -v linky_push_data:/data linky-push
```

`docker-compose.example.yml` is the same setup as a compose service with `/data` mounted so SQLite survives upgrades.

## Image and deploy

`.github/workflows/push-image.yml` publishes `ghcr.io/<owner>/linky-push`: pushes to `main` produce `:latest` and a `sha-...` tag, `push-v*` tags produce the matching tag. It uses the repository `GITHUB_TOKEN`, so the workflow needs package write permission. `.github/workflows/push-deploy.yml`, run by hand, pulls and restarts the `push` compose service on `push.linky.fit` over SSH.
