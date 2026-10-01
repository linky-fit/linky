# Migrations

One-time upgrades of persisted data. Migration-only code outside this folder points here with a `removal gate in app/migrations/AGENTS.md` comment.

## Removal gates

Earliest review is release 26.10.1. A migration is removed only with evidence that every supported upgrade source completed it, or with an enforced bridge upgrade that recovers offline devices; a release date or an absence of reports is not evidence. Remove each reader, flag, fixture and test together.

- Covered by this rule: `linkshuStorageMigration` (`linky.linkshu_storage_migration_v1`), `legacyAcceptedTokenDrain`, `MESSAGE_MIGRATION_VERSION`, `.migratedToEvolu.v2`, and linkstr's decoding of older persisted outbox receipts.
- Lane-to-shard (`laneToShardMigration.ts`, `useLaneToShardMigration.ts`, the legacy tables and columns in `evolu.ts`, `tests/lane-migration.spec.ts`, the `VITE_E2E` lane-seeding hook, the `evolu.migration` inspector events): additionally waits 180 days after the first production release carrying it. The cutoff is a `setting` row, first writer wins, so every device agrees. Extending the grace period is a one-constant change; shortening it strands rows.
- `wipeLinkshuSeedBoundState` stays; only its migration prologue is eligible.
