# Nostr error tracker

Local dashboard for the encrypted payment telemetry Linky clients send to the collector account's Nostr inbox.

```sh
bun install
bun run errors:dev
```

Open http://127.0.0.1:5190 and sign in with the collector account's 20-word Linky SLIP-39 recovery phrase. Only that phrase derives the Evolu owner; an nsec, a Nostr extension or a public npub cannot sign in. The seed stays in this browser's localStorage until you sign out.

The tracker groups errors by code, payment method and phase, and filters by version, period and platform. Filters live in the URL, so a view can be bookmarked. An issue can be marked solved; a newer occurrence reopens it. "Refresh inbox" reloads history from the default relays plus the collector's advertised inbox relays. There is no live subscription.

Resolutions sync through Evolu under an owner derived from the same seed, so signing in elsewhere restores them. The server defaults to `wss://evolu.linky.fit`; override it with a comma-separated `VITE_EVOLU_SERVER_URLS`. Only issue hashes and resolution timestamps go to Evolu, as append-only records; report contents and the seed stay out of it. The tracker never publishes Nostr events.

Decrypted reports stay in browser memory and render as text, never HTML. Older app versions did not redact messages, so raw payloads may contain sensitive data. The owner's local SQLite database stays on the device after sign-out. Counts are received reports, not unique users or failure rates. Encryption does not prove a report came from an official build, and relays that delete or cap events leave gaps the UI can only partly detect.

```sh
bun run --filter @linky-fit/nostr-error-tracker test
bun run --filter @linky-fit/nostr-error-tracker build
docker compose -f docker-compose.dev.yml up -d --wait evolu-relay
bun run --filter @linky-fit/nostr-error-tracker test:e2e   # browser check against the :4001 relay
```
