import type { CollectedInspectorRow, InspectorRow } from "./inspectorRows";

// In-memory core of the dev inspector collector: a ring buffer with monotonic
// row ids and cursor-based queries. Kept free of node/vite imports so the
// vitest suite can exercise it directly.

export const INSPECTOR_MAX_ROWS = 5_000;
export const INSPECTOR_QUERY_DEFAULT_LIMIT = 500;

export interface InspectorQuery {
  channel?: string;
  client?: string;
  /** Return rows with id greater than this. */
  cursor?: number;
  limit?: number;
}

interface InspectorQueryResult {
  /** Pass as the next query's cursor to resume where this one ended. */
  cursor: number;
  rows: CollectedInspectorRow[];
}

type InspectorStoreChange =
  | { kind: "append"; rows: CollectedInspectorRow[] }
  | { kind: "clear" };

export interface InspectorStore {
  append: (client: string, rows: InspectorRow[]) => CollectedInspectorRow[];
  clear: () => void;
  query: (query?: InspectorQuery) => InspectorQueryResult;
  subscribe: (listener: (change: InspectorStoreChange) => void) => () => void;
}

export const createInspectorStore = (
  maxRows: number = INSPECTOR_MAX_ROWS,
): InspectorStore => {
  const rows: CollectedInspectorRow[] = [];
  const listeners = new Set<(change: InspectorStoreChange) => void>();
  let nextId = 1;

  return {
    append(client, incoming) {
      const appended = incoming.map(
        (row): CollectedInspectorRow => ({ ...row, id: nextId++, client }),
      );
      rows.push(...appended);
      if (rows.length > maxRows) rows.splice(0, rows.length - maxRows);
      if (appended.length > 0) {
        for (const listener of listeners) {
          listener({ kind: "append", rows: appended });
        }
      }
      return appended;
    },

    clear() {
      // Ids keep counting past a clear so cursors held by pollers stay valid.
      rows.length = 0;
      for (const listener of listeners) listener({ kind: "clear" });
    },

    query({ channel, client, cursor = 0, limit } = {}) {
      const matching = rows.filter(
        (row) =>
          row.id > cursor &&
          (channel === undefined || row.channel === channel) &&
          (client === undefined || row.client === client),
      );
      if (limit !== undefined && matching.length > limit) {
        const page = matching.slice(0, limit);
        // Truncated page: resume from the last returned row. Otherwise return
        // the latest assigned id so pollers advance past filtered-out rows.
        return { rows: page, cursor: page[page.length - 1]?.id ?? cursor };
      }
      return { rows: matching, cursor: nextId - 1 };
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
