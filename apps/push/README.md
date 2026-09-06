# Linky Push Service

Bun HTTP service for Web Push and Android FCM delivery on top of outer NIP-17 inbox events (`kind: 1059`).

## What it does

- Issues short-lived ownership challenges per recipient pubkey
- Verifies signed Nostr proof events through Linkstr's shared ownership codec before storing subscriptions
- Persists web subscriptions, native Android tokens, and challenges in SQLite
- Watches configured Nostr relays through Linkstr's identity-free `PushInbox` for new push-marked outer `1059` events
- Sends a generic Web Push or Android FCM notification for every matching subscribed recipient pubkey
- Removes permanently invalid subscriptions when push delivery returns `404` or `410`, or when the push provider reports a VAPID public key mismatch
- Removes permanently invalid Android registration tokens when Firebase reports them as invalid or unregistered

The service does **not** decrypt inbox events and does **not** inspect wrapped inner content.

## Endpoints

### `POST /auth/challenge`

Request:

```json
{
  "pubkey": "<hex-pubkey>",
  "action": "subscribe"
}
```

`action` is optional and defaults to `"subscribe"`.

Response:

```json
{
  "pubkey": "<hex-pubkey>",
  "action": "subscribe",
  "challenge": "<nonce>",
  "expiresAt": 1760000000000
}
```

### `POST /subscribe`

Request:

```json
{
  "installationId": "<stable-installation-id>",
  "cleanupLegacySubscriptions": true,
  "subscription": {
    "endpoint": "https://example.push/service",
    "expirationTime": null,
    "keys": {
      "p256dh": "<base64>",
      "auth": "<base64>"
    }
  },
  "recipientPubkeys": ["<hex-pubkey-1>", "<hex-pubkey-2>"],
  "proofs": [
    {
      "pubkey": "<hex-pubkey-1>",
      "event": {
        "id": "<event-id>",
        "pubkey": "<hex-pubkey-1>",
        "created_at": 1760000000,
        "kind": 27235,
        "content": "linky-push-subscribe",
        "tags": [
          ["challenge", "<nonce>"],
          ["action", "subscribe"],
          ["pubkey", "<hex-pubkey-1>"]
        ],
        "sig": "<signature>"
      }
    }
  ]
}
```

Every pubkey listed in `recipientPubkeys` needs its own proof.

`installationId` and `cleanupLegacySubscriptions` are optional. A stable `installationId` lets a device replace its previous endpoint or token in place; `cleanupLegacySubscriptions: true` additionally drops older subscriptions for the same pubkeys that were registered without an installation id.

### `POST /native/subscribe`

Request:

```json
{
  "installationId": "<stable-installation-id>",
  "device": {
    "platform": "android",
    "token": "<fcm-token>"
  },
  "recipientPubkeys": ["<hex-pubkey-1>"],
  "proofs": [
    {
      "pubkey": "<hex-pubkey-1>",
      "event": {
        "id": "<event-id>",
        "pubkey": "<hex-pubkey-1>",
        "created_at": 1760000000,
        "kind": 27235,
        "content": "linky-push-subscribe",
        "tags": [
          ["challenge", "<nonce>"],
          ["action", "subscribe"],
          ["pubkey", "<hex-pubkey-1>"]
        ],
        "sig": "<signature>"
      }
    }
  ]
}
```

The server returns `503 native_push_unavailable` until `PUSH_FIREBASE_SERVICE_ACCOUNT_JSON` is configured.

### `POST /unsubscribe`

Remove selected pubkeys from a subscription with ownership proofs. If you remove the subscription's last remaining pubkey, the whole subscription row is deleted:

```json
{
  "endpoint": "https://example.push/service",
  "recipientPubkeys": ["<hex-pubkey>"],
  "proofs": [
    {
      "pubkey": "<hex-pubkey>",
      "event": {
        "id": "<event-id>",
        "pubkey": "<hex-pubkey>",
        "created_at": 1760000000,
        "kind": 27235,
        "content": "linky-push-unsubscribe",
        "tags": [
          ["challenge", "<nonce>"],
          ["action", "unsubscribe"],
          ["pubkey", "<hex-pubkey>"]
        ],
        "sig": "<signature>"
      }
    }
  ]
}
```

Every pubkey listed in `recipientPubkeys` needs its own unsubscribe proof. Full subscription removal requires proving ownership for the subscription's current pubkeys.

### `POST /native/unsubscribe`

```json
{
  "token": "<fcm-token>",
  "recipientPubkeys": ["<hex-pubkey>"],
  "proofs": [
    {
      "pubkey": "<hex-pubkey>",
      "event": {
        "id": "<event-id>",
        "pubkey": "<hex-pubkey>",
        "created_at": 1760000000,
        "kind": 27235,
        "content": "linky-push-unsubscribe",
        "tags": [
          ["challenge", "<nonce>"],
          ["action", "unsubscribe"],
          ["pubkey", "<hex-pubkey>"]
        ],
        "sig": "<signature>"
      }
    }
  ]
}
```

### `GET /vapid-public-key`

Returns `{ "vapidPublicKey": "<base64url>" }` so web clients can subscribe with the server's VAPID key.

### `GET /health`

Simple health check.

### `GET /`

Returns the build commit SHA as plain text.

- Docker/GitHub Actions builds inject it automatically.
- Local `bun run` execution returns `unknown` unless `BUILD_COMMIT_SHA` is set in the environment.

## Push payload

Every delivered Web Push message contains:

```json
{
  "title": "Linky - npub1abcd...wxyz",
  "body": "Nová aktivita v Linky",
  "data": {
    "type": "nostr_inbox",
    "outerEventId": "<outer-event-id>",
    "recipientPubkey": "<hex-pubkey>",
    "recipientNpub": "<npub>",
    "createdAt": 1760000000,
    "relayHints": ["wss://relay.example"]
  }
}
```

The title carries a shortened recipient npub so a device subscribed for several identities can tell them apart; the body is a fixed generic text because the service never sees message content.

Android FCM deliveries carry `title`, `body`, and the same data fields in the FCM data payload, with `createdAt` as a string and `relayHints` encoded as a JSON string array.

## Environment

Copy `.env.example` and set the required values:

- `PUSH_VAPID_SUBJECT`
- `PUSH_VAPID_PUBLIC_KEY`
- `PUSH_VAPID_PRIVATE_KEY`
- `PUSH_FIREBASE_SERVICE_ACCOUNT_JSON` for Android native push delivery

Optional values cover the port, storage path, relay list, challenge TTL, proof age window, rate limits, and subscription caps.

`PUSH_CORS_ORIGIN` accepts either `*` or a comma-separated list of allowed web app origins, for example:

```bash
PUSH_CORS_ORIGIN=http://localhost:5173,http://127.0.0.1:5173,http://127.0.0.1:5174
```

Generate VAPID keys locally with:

```bash
bunx web-push generate-vapid-keys
```

`PUSH_FIREBASE_SERVICE_ACCOUNT_JSON` should contain a single-line Firebase service account JSON blob with `project_id`, `client_email`, and `private_key`.

## Local run

Install dependencies from the repo root:

```bash
bun install
```

Start the service in watch mode:

```bash
bun run --filter @linky/push dev
```

Run once:

```bash
bun run --filter @linky/push start
```

Type-check just this workspace:

```bash
bun run --filter @linky/push typecheck
```

Run the repo-wide checks after changes:

```bash
bun run check-code
```

## Docker

Build the image from the repo root:

```bash
docker build -f apps/push/Dockerfile -t linky-push .
```

To embed the current git revision in a local image build:

```bash
docker build \
  -f apps/push/Dockerfile \
  --build-arg GIT_COMMIT_SHA="$(git rev-parse HEAD)" \
  -t linky-push .
```

Run it with a persistent SQLite volume:

```bash
docker run --rm \
  -p 8787:8787 \
  -e PUSH_VAPID_SUBJECT=mailto:alerts@example.com \
  -e PUSH_VAPID_PUBLIC_KEY=replace-me \
  -e PUSH_VAPID_PRIVATE_KEY=replace-me \
  -e PUSH_FIREBASE_SERVICE_ACCOUNT_JSON='{"project_id":"...","client_email":"...","private_key":"-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n"}' \
  -e PUSH_STORAGE_PATH=/data/linky-push.sqlite \
  -v linky_push_data:/data \
  linky-push
```

Production-oriented examples are included in:

- `apps/push/docker-compose.example.yml`
- `apps/push/.env.production.example`

Copy `.env.production.example` to `.env.production` before starting the compose stack.

The compose example mounts `/data` so SQLite survives container restarts and image upgrades.

## GitHub Container Registry

The workflow at `.github/workflows/push-image.yml` builds and publishes `ghcr.io/<owner>/linky-push`.

- Pushes to `main` publish `:latest` and a `sha-...` tag.
- Tags matching `push-v*` publish the matching tag as well.
- Publishing uses the repository `GITHUB_TOKEN`, so package write permission must stay enabled for the workflow.
