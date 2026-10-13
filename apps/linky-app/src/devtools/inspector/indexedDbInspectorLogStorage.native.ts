import { localStorageKv } from "../../utils/storage";
import { parseCollectedInspectorRow } from "./inspectorRows";
import type { InspectorLogStorage } from "./persistentInspectorLogBuffer";

// No IndexedDB on native: each row is a localStorage (expo-sqlite) entry, listed by an index entry. Logout clears both.
const INDEX_KEY = "linky.inspectorLogs.ids";
const rowKey = (id: number): string => `linky.inspectorLogs.row.${id}`;

const readIds = (): number[] => {
  try {
    const parsed: unknown = JSON.parse(
      localStorageKv.getItem(INDEX_KEY) ?? "[]",
    );
    return Array.isArray(parsed)
      ? parsed.filter((id): id is number => typeof id === "number")
      : [];
  } catch {
    return [];
  }
};

const readRow = (id: number) => {
  try {
    return parseCollectedInspectorRow(
      JSON.parse(localStorageKv.getItem(rowKey(id)) ?? "null"),
    );
  } catch {
    return null;
  }
};

export const indexedDbInspectorLogStorage: InspectorLogStorage = {
  async apply({ appendedRows, deletedRows }) {
    if (appendedRows.length === 0 && deletedRows.length === 0) return;
    const deleted = new Set(deletedRows.map((row) => row.id));
    for (const id of deleted) localStorageKv.removeItem(rowKey(id));
    for (const row of appendedRows)
      localStorageKv.setItem(rowKey(row.id), JSON.stringify(row));
    const ids = readIds().filter((id) => !deleted.has(id));
    localStorageKv.setItem(
      INDEX_KEY,
      JSON.stringify([...ids, ...appendedRows.map((row) => row.id)]),
    );
  },

  async clear() {
    for (const id of readIds()) localStorageKv.removeItem(rowKey(id));
    localStorageKv.removeItem(INDEX_KEY);
  },

  async load() {
    return readIds().flatMap((id) => readRow(id) ?? []);
  },
};
