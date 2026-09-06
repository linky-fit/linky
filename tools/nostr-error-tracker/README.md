# Nostr error tracker

Local dashboard for errors already reported by Linky. It reads encrypted payment
telemetry from the signed-in account's Nostr inbox. No changes to the reporting
clients are required.

From the repository root:

```sh
bun install
bun run errors:dev
```

Open **http://127.0.0.1:5190**. Sign in with the collector account's 20-word
Linky SLIP-39 recovery phrase. The seed is saved in localStorage so reloads
restore your login. Sign out removes the saved seed and reloads the page.
Nostr extensions, nsec-only keys, and public npubs cannot derive the Evolu owner.

The tracker groups errors by code, payment method and phase. Unknown errors also
use their message for grouping. Select an issue, then an occurrence, to inspect
its message, version, platform, runtime, app host, mint, amount/fee buckets,
timestamps, report identifiers, and original payload. Select multiple versions
from the newest-first list and combine them with a relative period or custom
from/to dates. Custom dates use local time and include the entire end date;
either endpoint can be left empty. Filters apply to both issue counts and
occurrence details. Successes and expected declines are omitted. Filters, sort
order, and solved visibility update the URL and restore on reload or after login.
Bookmark or copy the address to reopen the same view. For example:
`http://127.0.0.1:5190/?version=26.9.7&version=26.9.6&period=7&platform=android`.
Use repeated `version` parameters for multiple releases; `period` accepts `all`,
`1`, `7`, `30`, `90`, or `custom`. Custom dates use `from=YYYY-MM-DD` and
`to=YYYY-MM-DD`; either may be omitted. Other parameters are `q`, `runtime`,
`host`, `mint`, `solved=1`, and `sort=frequent`. Relative ranges are calculated
when opened. Back/Forward restores selections; typing in search updates the
current history entry.

It scans available history from the default relays and the collector's advertised
inbox/read relays. Use **Relays** to change the starting URLs, then **Refresh
inbox** to apply them. `wss://` is supported everywhere; `ws://` is accepted only
for loopback hosts. Refresh reloads history; this is not a live subscription.

Use **Mark as solved** to hide an issue. **Show solved issues** includes solved
issues alongside open and reoccurred issues. A newer occurrence after resolution
reopens the issue with a **reoccurred** badge. This uses report timestamps, not
arrival time, so old reports delivered later stay solved. Timestamps have
one-second precision. Resolution applies to the whole issue across versions and
dates, even when the current view is filtered.

Resolutions sync through Evolu using a dedicated owner derived from the same
seed. Signing in with that seed on another browser restores them. The default
server is `wss://evolu.linky.fit`; override it with a comma-separated
`VITE_EVOLU_SERVER_URLS` environment variable. Changes commit locally before
syncing, so offline resolutions sync when connectivity returns. Only issue hashes
and resolution timestamps are stored in Evolu; report contents remain in Nostr.
The owner-specific local SQLite database remains on this device after sign-out.

Decrypted reports stay in browser memory. There is no analytics or Nostr event
publishing. Historical raw messages may contain sensitive data because the old
reporters did not redact them. They are rendered as text, never HTML.

Missing version/platform/host values cannot be reconstructed. Counts describe
received error reports, not unique users or failure rates. Nostr encryption does
not authenticate a report as originating from an official Linky build. Pagination
cannot retrieve events a relay has deleted or refuses to return; the UI exposes
known incomplete scans, but undisclosed relay caps can still hide events.

```sh
bun run --filter @linky/nostr-error-tracker test
bun run --filter @linky/nostr-error-tracker build
```

For browser verification with encrypted Nostr fixtures and real Evolu sync across
isolated browser contexts:

```sh
docker compose -f docker-compose.dev.yml up -d --wait evolu-relay
bun run --filter @linky/nostr-error-tracker test:e2e
```

The check starts its own Vite server and uses only the local Evolu relay on :4001.
