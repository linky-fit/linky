# Linky push service

Bun HTTP service that sends Web Push and Android FCM notifications when a push-marked NIP-17 wrap (`kind: 1059`) arrives for a subscribed pubkey. It watches the configured relays through linkstr's `PushInbox` and never decrypts anything. Every notification has a fixed body and a title with the recipient's shortened npub, so a device subscribed for several identities can tell them apart.

A client proves it owns a pubkey by signing a short-lived challenge: `POST /auth/challenge`, then `POST /subscribe` or `POST /native/subscribe` with one proof per pubkey. `/unsubscribe` and `/native/unsubscribe` work the same way. Other endpoints: `GET /vapid-public-key`, `GET /health` and `GET /` (build commit). Subscriptions, native tokens and challenges live in SQLite. A subscription the provider reports as gone (`404`, `410`, VAPID mismatch, unregistered FCM token) is deleted.

`POST /reminders` replaces a pubkey's set of recurring-payment reminder times, the due times of its payments (at most `PUSH_MAX_REMINDERS_PER_PUBKEY`, default 32; an empty array clears them), under a `subscribe` proof. The server stores only the pubkey and the times, never notes, amounts or recipients. Every 15 seconds the dispatcher sends `{ "type": "recurring_reminder", "notifyAtSec": … }` to each web and Android subscription of a pubkey whose time has come (web push TTL one hour) and drops reminders more than an hour overdue. The web app's service worker turns the push into a nudge to open the app, named by the notes the device keeps for that `notifyAtSec`, and shows nothing while a Linky window is open, because a running app sends due payments itself.

## Run

```bash
bun install
bun run --filter @linky-fit/push dev        # watch mode, reads the committed .env.development
bun run --filter @linky-fit/push start      # once
bun run --filter @linky-fit/push typecheck
```

## Environment

For a deployment, copy `.env.example` and set:

- `PUSH_VAPID_SUBJECT`, `PUSH_VAPID_PUBLIC_KEY`, `PUSH_VAPID_PRIVATE_KEY`: generate with `bunx web-push generate-vapid-keys`
- `PUSH_FIREBASE_SERVICE_ACCOUNT_JSON` for Android: a single-line service account JSON. Without it `/native/subscribe` answers `503 native_push_unavailable`

`.env.example` lists the optional settings: port, storage path, relays, CORS origin, challenge TTL, proof age, rate limits and subscription caps.

`PUSH_TRUSTED_PROXY_IPS` is empty by default. Set it to the exact peer IPs of reverse proxies you control, otherwise every client behind the proxy shares one rate-limit bucket. For a trusted peer the server walks `X-Forwarded-For` from right to left and stops at the first untrusted address, so the proxy must append to or replace the header. Behind a host proxy forwarding into Docker, the peer the container sees may be the bridge gateway, not `127.0.0.1`.

Delivery goes only to public HTTPS endpoints on port 443 over pinned DNS, without following redirects, with a bounded body and deadline; a local or private push endpoint is refused. Logs omit client IPs, pubkeys and provider response bodies.

## Docker

```bash
docker build -f apps/push/Dockerfile --build-arg GIT_COMMIT_SHA="$(git rev-parse HEAD)" -t linky-push .
cp apps/push/.env.production.example apps/push/.env.production   # fill in the values
docker run --rm -p 8787:8787 --env-file apps/push/.env.production \
  -e PUSH_STORAGE_PATH=/data/linky-push.sqlite -v linky_push_data:/data linky-push
```

`docker-compose.example.yml` is the same setup as a compose service, with `/data` mounted so SQLite survives upgrades.

## Image and deploy

`.github/workflows/push-image.yml` publishes `ghcr.io/<owner>/linky-push`: pushes to `main` produce `:latest` and a `sha-...` tag, `push-v*` tags produce the matching tag. `.github/workflows/push-deploy.yml`, run by hand, pulls and restarts the `push` compose service on `push.linky.fit` over SSH.
