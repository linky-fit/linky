---
name: adding-inspector-events
description: Design rules for emitting events to the Linky inspector. Use whenever adding, changing, or reviewing inspector event emission — any time app code should report an operation, wire traffic, or another log-worthy fact to the inspector timeline (Nostr, cashu, evolu, push, app logs).
---

# Adding inspector events

The inspector is a domain-agnostic event timeline with one pipeline: producers call
`reportInspectorRows` (`apps/web-app/src/devtools/inspector/`), rows are sanitized once
and fanned out to every active sink — the in-memory viewer store, the persistent 24h
log buffer, and (dev only) the Vite collector. The viewer correlates rows across
domains by shared link ids; that cross-domain correlation is the whole point of one
inspector instead of per-domain debug pages.

## When to emit

Emit for facts someone would want while debugging a user's exported 24h log:
operations a user initiated (send message, pay, claim token), cross-boundary traffic
(relay publishes/receives, mint calls, evolu sync, push arrivals), and surprising
state transitions (retries, rotations, rejections). Do not emit per-render facts,
tight-loop internals, or anything derivable from an already-emitted row.

## Row design

One event = one `InspectorRow`: `{ at, channel, tag, summary, links, context?, payload }`.

- **channel** — namespaced lowercase `domain.category`, validated structurally
  (never by enum): `nostr.operation`, `nostr.wire`, `cashu`, `evolu.sync`, `push`,
  `app.log`. Reuse an existing domain prefix; add a new domain only if the event fits
  none. Use `.operation` (app-level intent/fact) vs `.wire` (raw I/O) when a domain
  has both altitudes. Never add code that enumerates the known channels — the viewer
  derives filter chips and colors from observed rows and must render unknown
  channels from newer builds.
- **tag** — stable, specific, greppable event name (`reactions.react`,
  `WirePublished`). Renaming a tag breaks archaeology on saved log files; prefer
  adding a new tag over renaming.
- **links** — a `label -> id | ids` map. Attach EVERY identifier that ties this
  event to related events in any domain: gift-wrap ids (`wrap`), rumor id (`rumor`),
  optimistic-update id (`client`), cashu quote/token ids, evolu mutation ids. Rows
  sharing any id are correlated in the viewer. Reuse existing labels for the same
  concept. An event whose links could never match another row is usually reported
  at the wrong altitude.
- **context** — a `label -> value` map for location/environment metadata (`relay`,
  `mint`). Shown in the detail pane but NEVER correlated on — a relay url would link
  most wire rows to each other. If many rows would share the value and that sharing
  is not a story, it belongs in `context`, not `links`.
- **summary** — one human-readable line, prebuilt by the reporter.
- **payload** — the raw event data. It passes through `toJsonSafe` (string/array/depth
  truncation), so pass it as-is; don't pre-format or pre-truncate.

For an `app.log` row call `reportAppLog` (`devtools/inspector/appLog.ts`); it stamps
`at`, defaults `links`, and gates on `getInspectorEmissionEnabled()` for you.

## Hard rules

- **NEVER put key material in any field** — nsec, seed words, derived private keys,
  mint secrets, VAPID keys. Decrypted message *content* is acceptable by design (the
  settings copy discloses it); keys are not, in any form, including inside payloads.
- **Emission cost when disabled**: check `getInspectorEmissionEnabled()` before
  constructing the row — a disabled inspector must cost one boolean per event site.
  For stream-like producers, follow the linkstr-bridge pattern
  (`useLinkstrInspectorBridge`): don't attach the producer at all while disabled.
- **Wire-format stability**: rows are a persisted format (24h IndexedDB buffer,
  exported/imported ndjson). Only add optional fields; never rename, remove, or
  retype existing ones. Parsers stay lenient — unknown channels, link labels, and
  extra fields must pass validation (`parseInspectorRow` checks structure, not
  vocabulary).

## Checklist for a new event

1. Pick channel (existing domain if possible) and a stable tag.
2. Attach all correlating ids to `links`, location metadata to `context`.
3. Gate emission behind `getInspectorEmissionEnabled()`.
4. Add a glossary entry (`inspectorPage/inspectorGlossary.ts`) saying what the event
   means and when it fires.
5. Unit-test any schema touch with an export → import round-trip
   (`serializeInspectorLogsNdjson` → `parseInspectorNdjson`).
6. Verify in the viewer (`#advanced/inspector` or dev `inspector.html`) that the new
   rows correlate with their related rows.
