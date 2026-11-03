import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function createStoragePath(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  return join(directory, "push.sqlite");
}

export function removeStoragePath(path: string): void {
  rmSync(join(path, ".."), { recursive: true, force: true });
}

/** Reads the counters the way the monitoring collector does: straight from SQLite. */
export function readPushStats(path: string): Record<string, number> {
  const db = new Database(path, { readonly: true });
  try {
    const rows = db
      .query<
        { name: string; value: number },
        []
      >("SELECT name, value FROM push_stats")
      .all();
    return Object.fromEntries(rows.map((row) => [row.name, row.value]));
  } finally {
    db.close();
  }
}
