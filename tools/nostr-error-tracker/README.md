# Nostr error tracker

Local dashboard for the encrypted payment telemetry Linky clients already send to the collector account's Nostr inbox. Nothing changes on the reporting side.

```sh
bun install
bun run errors:dev
```

Open http://127.0.0.1:5190 and sign in with the collector account's 20-word Linky SLIP-39 recovery phrase. The seed stays in this browser's localStorage until you sign out; nsec-only keys, Nostr extensions and public npubs cannot derive the Evolu owner, so they cannot sign in. The tracker groups errors by code, payment method and phase, filters by version, period and platform (the filters live in the URL, so a view can be bookmarked), and lets you mark an issue solved. A newer occurrence reopens a solved issue. **Refresh inbox** reloads history from the default relays plus the collector's advertised inbox relays; it is not a live subscription.

Resolutions sync through Evolu under a dedicated owner derived from the same seed, so signing in elsewhere restores them. The server defaults to `wss://evolu.linky.fit`; override it with a comma-separated `VITE_EVOLU_SERVER_URLS`. Only issue hashes and resolution timestamps go to Evolu; report contents stay in Nostr.

Privacy and limits: decrypted reports stay in browser memory and are rendered as text, never HTML. Older reporters did not redact messages, so raw payloads may contain sensitive data. The owner's local SQLite database stays on the device after sign-out. Counts are received reports, not unique users or failure rates; encryption does not prove a report came from an official build; relays that delete or cap events leave gaps the UI can only partly detect.

```sh
bun run --filter @linky-fit/nostr-error-tracker test
bun run --filter @linky-fit/nostr-error-tracker build
docker compose -f docker-compose.dev.yml up -d --wait evolu-relay
bun run --filter @linky-fit/nostr-error-tracker test:e2e   # browser check against the :4001 relay
```
