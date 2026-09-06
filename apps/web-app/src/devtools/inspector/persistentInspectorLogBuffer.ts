import type { CollectedInspectorRow, InspectorRow } from "./inspectorRows";

const INSPECTOR_LOG_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const INSPECTOR_LOG_MAX_SIZE = 25 * 1024 * 1024;

export interface IncomingPersistentInspectorRow {
  client: string;
  row: InspectorRow;
}

interface PersistentInspectorLogEntry {
  row: CollectedInspectorRow;
  size: number;
}

export interface PersistentInspectorLogState {
  entries: PersistentInspectorLogEntry[];
  nextId: number;
  totalSize: number;
}

interface PersistentInspectorLogMutation {
  appendedRows: CollectedInspectorRow[];
  deletedRows: CollectedInspectorRow[];
  state: PersistentInspectorLogState;
}

interface PersistentInspectorLogLimits {
  maxAgeMs: number;
  maxSize: number;
}

export interface PersistentInspectorLogStats {
  oldestAt: number | null;
  rowCount: number;
  totalSize: number;
}

const defaultLimits: PersistentInspectorLogLimits = {
  maxAgeMs: INSPECTOR_LOG_MAX_AGE_MS,
  maxSize: INSPECTOR_LOG_MAX_SIZE,
};

export const inspectorLogRowSize = (row: CollectedInspectorRow): number =>
  JSON.stringify(row).length;

const pruneEntries = (
  entries: PersistentInspectorLogEntry[],
  now: number,
  limits: PersistentInspectorLogLimits,
): PersistentInspectorLogEntry[] => {
  const cutoff = now - limits.maxAgeMs;
  const retained = entries.filter((entry) => entry.row.at >= cutoff);
  let totalSize = retained.reduce((sum, entry) => sum + entry.size, 0);
  let firstRetainedIndex = 0;

  while (firstRetainedIndex < retained.length && totalSize > limits.maxSize) {
    totalSize -= retained[firstRetainedIndex]?.size ?? 0;
    firstRetainedIndex += 1;
  }

  return retained.slice(firstRetainedIndex);
};

const makeState = (
  entries: PersistentInspectorLogEntry[],
  nextId: number,
): PersistentInspectorLogState => ({
  entries,
  nextId,
  totalSize: entries.reduce((sum, entry) => sum + entry.size, 0),
});

export const createPersistentInspectorLogState = (
  rows: CollectedInspectorRow[],
  now: number,
  limits: PersistentInspectorLogLimits = defaultLimits,
): PersistentInspectorLogMutation => {
  const orderedRows = [...rows].sort(
    (left, right) => left.id - right.id || left.at - right.at,
  );
  const nextId =
    orderedRows.reduce((highest, row) => Math.max(highest, row.id), 0) + 1;
  const entries = orderedRows.map((row) => ({
    row,
    size: inspectorLogRowSize(row),
  }));
  const retainedEntries = pruneEntries(entries, now, limits);
  const retainedRows = new Set(retainedEntries.map((entry) => entry.row));

  return {
    appendedRows: [],
    deletedRows: orderedRows.filter((row) => !retainedRows.has(row)),
    state: makeState(retainedEntries, nextId),
  };
};

export const appendPersistentInspectorLogRows = (
  state: PersistentInspectorLogState,
  incoming: IncomingPersistentInspectorRow[],
  now: number,
  limits: PersistentInspectorLogLimits = defaultLimits,
): PersistentInspectorLogMutation => {
  let nextId = state.nextId;
  const newEntries = incoming.map(({ client, row }) => {
    const collectedRow: CollectedInspectorRow = {
      ...row,
      client,
      id: nextId,
    };
    nextId += 1;
    return { row: collectedRow, size: inspectorLogRowSize(collectedRow) };
  });
  const retainedEntries = pruneEntries(
    [...state.entries, ...newEntries],
    now,
    limits,
  );
  const retainedRows = new Set(retainedEntries.map((entry) => entry.row));

  return {
    appendedRows: newEntries
      .map((entry) => entry.row)
      .filter((row) => retainedRows.has(row)),
    deletedRows: state.entries
      .map((entry) => entry.row)
      .filter((row) => !retainedRows.has(row)),
    state: makeState(retainedEntries, nextId),
  };
};

export const getPersistentInspectorLogRows = (
  state: PersistentInspectorLogState,
): CollectedInspectorRow[] => state.entries.map((entry) => entry.row);

export const getPersistentInspectorLogStats = (
  state: PersistentInspectorLogState,
): PersistentInspectorLogStats => ({
  oldestAt: state.entries.reduce<number | null>(
    (oldest, entry) =>
      oldest === null ? entry.row.at : Math.min(oldest, entry.row.at),
    null,
  ),
  rowCount: state.entries.length,
  totalSize: state.totalSize,
});

export const serializeInspectorLogsNdjson = (
  rows: CollectedInspectorRow[],
): string =>
  rows.length === 0
    ? ""
    : `${[...rows]
        .sort((left, right) => left.id - right.id || left.at - right.at)
        .map((row) => JSON.stringify(row))
        .join("\n")}\n`;
