import type { Page } from "@playwright/test";
import type { LinkyE2eHooks } from "../../src/devtools/e2e/installLinkyE2eHooks";

declare global {
  interface Window {
    __linkyE2E?: LinkyE2eHooks;
  }
}

type Row = Readonly<Record<string, unknown>>;

/** Live rows of a table merged across the scope's visible shards. */
export const shardRows = (
  page: Page,
  scope: string,
  table: string,
): Promise<ReadonlyArray<Row>> =>
  page.evaluate(
    ({ scope, table }) => {
      if (!window.__linkyE2E) throw new Error("test hooks missing");
      return window.__linkyE2E.shardRows(scope, table);
    },
    { scope, table },
  );

export const shardOwnerId = (
  page: Page,
  scope: string,
  index: number,
): Promise<string> =>
  page.evaluate(
    ({ scope, index }) => {
      if (!window.__linkyE2E) throw new Error("test hooks missing");
      return window.__linkyE2E.shardOwnerId(scope, index);
    },
    { scope, index },
  );

export const syncOwnerIds = (page: Page): Promise<ReadonlyArray<string>> =>
  page.evaluate(() => {
    if (!window.__linkyE2E) throw new Error("test hooks missing");
    return window.__linkyE2E.syncOwnerIds();
  });

/** False also while the app has not booted far enough to install the hooks. */
export const isHydrated = (page: Page): Promise<boolean> =>
  page.evaluate(() => window.__linkyE2E?.hydrated() ?? false);

/** Each scope's active shard index, from the synced pointer rows. */
export const shardIndexes = async (
  page: Page,
): Promise<Record<string, unknown>> =>
  Object.fromEntries(
    (await shardRows(page, "meta", "shardPointer")).map((row) => [
      row.scope,
      row.index,
    ]),
  );

export const createRowId = (page: Page): Promise<string> =>
  page.evaluate(() => {
    if (!window.__linkyE2E) throw new Error("test hooks missing");
    return window.__linkyE2E.createId();
  });

/** A raw Evolu upsert under the given owner, bypassing the app's repositories. */
export const upsertRow = (
  page: Page,
  table: string,
  row: Row,
  ownerId: string,
): Promise<void> =>
  page.evaluate(
    ({ table, row, ownerId }) => {
      if (!window.__linkyE2E) throw new Error("test hooks missing");
      return window.__linkyE2E.upsert(table, row, ownerId);
    },
    { table, row, ownerId },
  );
