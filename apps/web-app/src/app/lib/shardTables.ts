import { linkyScopes, type LinkyScope } from "@linky/linksync";
import type { ShardSummary } from "../hooks/useLinksync";

const SCOPES = Object.keys(linkyScopes).filter((scope): scope is LinkyScope =>
  Object.hasOwn(linkyScopes, scope),
);

/** The scope a table lives in; null for the legacy lane tables the migration reads. */
export const scopeOfTable = (table: string): LinkyScope | null =>
  SCOPES.find((scope) =>
    linkyScopes[scope].tables.some((known) => known === table),
  ) ?? null;

/** The rows of a shard table the store would read: those in the scope's visible shards. */
export const filterRowsToVisibleShards = <Row>(
  table: string,
  rows: ReadonlyArray<Row>,
  shards: ReadonlyArray<ShardSummary>,
  ownerIdOf: (row: Row) => string,
): ReadonlyArray<Row> => {
  const scope = scopeOfTable(table);
  const summary = shards.find((shard) => shard.scope === scope);
  if (scope === null || summary === undefined) return rows;
  const visible = new Set(summary.visibleOwnerIds);
  return rows.filter((row) => visible.has(ownerIdOf(row)));
};

export const shortOwnerId = (ownerId: string): string =>
  ownerId.length > 12 ? `${ownerId.slice(0, 6)}…${ownerId.slice(-4)}` : ownerId;
