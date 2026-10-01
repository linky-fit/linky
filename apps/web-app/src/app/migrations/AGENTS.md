# Migrations

One-time upgrades of persisted data. Migration-only code elsewhere carries a `removal gate in app/migrations/AGENTS.md` comment; grep for it to find every piece.

## Removal gate

Earliest review is release 26.10.1. A migration is removed only with evidence that every supported upgrade source completed it, or with an enforced bridge upgrade that recovers offline devices; a release date or an absence of reports is not evidence. Remove each reader, flag, fixture and test together.

The gate also covers linkstr's decoding of older persisted outbox receipts. Lane-to-shard additionally waits out `LANE_MIGRATION_GRACE_PERIOD_MS` after the first production release carrying it; its pieces include `tests/lane-migration.spec.ts`, the `VITE_E2E` lane-seeding hook and the `evolu.migration` inspector events.
