---
name: adding-inspector-events
description: Design rules for emitting events to the Linky inspector. Use whenever adding, changing, or reviewing inspector event emission, i.e. any time app code should report an operation, wire traffic, or another log-worthy fact to the inspector timeline (Nostr, cashu, evolu, push, app logs).
---

# Adding inspector events

Producers call `reportInspectorRows` (`apps/web-app/src/devtools/inspector/`). It makes each payload JSON-safe once and fans the rows out to every active sink: the in-memory viewer store, the persistent 24h log buffer, and in dev the Vite collector. The viewer correlates rows across domains by shared link ids, which is why there is one inspector instead of per-domain debug pages.

## When to emit

Emit what someone debugging a user's exported 24h log would want: operations the user started (send message, pay, claim token), cross-boundary traffic (relay publishes and receives, mint calls, evolu sync, push arrivals) and surprising state transitions (retries, rotations, rejections). Skip per-render facts, tight-loop internals and anything derivable from a row already emitted.

## Row design

One event is one `InspectorRow`: `{ at, channel, tag, summary, links, context?, payload }`.

- `channel` is a lowercase `domain.category`, validated by structure, not by enum: `nostr.operation`, `nostr.wire`, `cashu`, `evolu.sync`, `push`, `app.log`. Reuse an existing domain; when a domain has both levels, `.operation` is app-level intent and `.wire` is raw I/O. The viewer derives filter chips and colors from observed rows and must render unknown channels from newer builds, so no code enumerates the known channels.
- `tag` is a stable, greppable event name (`reactions.react`, `WirePublished`). Saved log files are searched by tag, so add a new tag instead of renaming one.
- `links` maps a label to an id or ids. Attach every identifier that ties the event to related events in any domain: gift-wrap id (`wrap`), rumor id (`rumor`), optimistic-update id (`client`), cashu quote and token ids, evolu mutation ids. Rows sharing any id are correlated. Reuse existing labels for the same concept. An event whose links can never match another row is usually reported at the wrong level.
- `context` maps a label to location or environment metadata (`relay`, `mint`). The detail pane shows it but never correlates on it: a relay URL would link most wire rows to each other. A value many rows share without telling a story belongs here.
- `summary` is one human-readable line built by the reporter.
- `payload` is the raw event data. `reportInspectorRows` truncates strings, arrays and depth, so pass it as-is.

For an `app.log` row call `reportAppLog` (`devtools/inspector/appLog.ts`); it stamps `at`, defaults `links` and checks `getInspectorEmissionEnabled()`.

## Hard rules

- No key material in any field, payloads included: nsec, seed words, derived private keys, mint secrets, VAPID keys, and encoded cashu tokens (`cashuA`/`cashuB`), whose proofs let any holder spend them. Log the token id, amount and mint instead. Decrypted message content is acceptable by design; the settings copy discloses it. `reportInspectorRows` does not redact; linkstr's own emissions pass through `redactInspectorSecrets`, app producers strip secrets before reporting.
- Check `getInspectorEmissionEnabled()` before building the row, so a disabled inspector costs one boolean per event site. For stream-like producers, follow `useLinkstrInspectorBridge` and don't attach the producer while disabled.
- Rows are a persisted format (24h IndexedDB buffer, exported and imported ndjson). Only add optional fields; never rename, remove or retype existing ones. `parseInspectorRow` checks structure, not vocabulary, so unknown channels, link labels and extra fields must keep passing.

## Checklist for a new event

1. Pick the channel (an existing domain if possible) and a stable tag.
2. Put every correlating id in `links`, location metadata in `context`.
3. Gate emission behind `getInspectorEmissionEnabled()`.
4. Add an entry to `apps/web-app/src/devtools/inspectorPage/inspectorGlossary.ts` saying what the event means and when it fires.
5. When the row schema changes, unit-test an export and import round-trip (`serializeInspectorLogsNdjson`, then `parseInspectorNdjson`).
6. Check in the viewer (`#advanced/inspector`, or `/inspector.html` in dev) that the new rows correlate with their related rows.
