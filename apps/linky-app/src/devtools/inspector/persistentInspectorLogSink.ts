import { indexedDbInspectorLogStorage } from "./indexedDbInspectorLogStorage";
import {
  appendPersistentInspectorLogRows,
  createPersistentInspectorLogState,
  getPersistentInspectorLogRows,
  getPersistentInspectorLogStats,
  serializeInspectorLogsNdjson,
  type IncomingPersistentInspectorRow,
  type PersistentInspectorLogState,
  type PersistentInspectorLogStats,
} from "./persistentInspectorLogBuffer";
import type { InspectorRow } from "./inspectorRows";

const FLUSH_DELAY_MS = 250;

const pendingRows: IncomingPersistentInspectorRow[] = [];
const listeners = new Set<(stats: PersistentInspectorLogStats) => void>();
let flushTimeoutId: ReturnType<typeof setTimeout> | null = null;
let state: PersistentInspectorLogState | null = null;
let initialization: Promise<PersistentInspectorLogState> | null = null;
let operationQueue = Promise.resolve();

const notify = (): void => {
  if (state === null) return;
  const stats = getPersistentInspectorLogStats(state);
  for (const listener of listeners) listener(stats);
};

const enqueueOperation = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = operationQueue.then(operation, operation);
  operationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

const loadState = async (): Promise<PersistentInspectorLogState> => {
  const rows = await indexedDbInspectorLogStorage.load();
  const initialized = createPersistentInspectorLogState(rows, Date.now());
  await indexedDbInspectorLogStorage.apply(initialized);
  state = initialized.state;
  notify();
  return initialized.state;
};

const ensureState = (): Promise<PersistentInspectorLogState> => {
  if (state !== null) return Promise.resolve(state);
  initialization ??= loadState();
  return initialization;
};

const flushPendingRows = async (): Promise<void> => {
  if (flushTimeoutId !== null) {
    clearTimeout(flushTimeoutId);
    flushTimeoutId = null;
  }
  if (pendingRows.length === 0) return;
  const incoming = pendingRows.splice(0);

  await enqueueOperation(async () => {
    const currentState = await ensureState();
    const mutation = appendPersistentInspectorLogRows(
      currentState,
      incoming,
      Date.now(),
    );
    await indexedDbInspectorLogStorage.apply(mutation);
    state = mutation.state;
    notify();
  });
};

const scheduleFlush = (): void => {
  if (flushTimeoutId !== null) return;
  flushTimeoutId = setTimeout(() => void flushPendingRows(), FLUSH_DELAY_MS);
};

export const appendPersistentInspectorLogs = (
  client: string,
  rows: InspectorRow[],
): void => {
  pendingRows.push(...rows.map((row) => ({ client, row })));
  scheduleFlush();
};

export const initializePersistentInspectorLogs =
  async (): Promise<PersistentInspectorLogStats> => {
    const currentState = await enqueueOperation(ensureState);
    return getPersistentInspectorLogStats(currentState);
  };

export const subscribePersistentInspectorLogs = (
  listener: (stats: PersistentInspectorLogStats) => void,
): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const clearPersistentInspectorLogs = async (): Promise<void> => {
  pendingRows.length = 0;
  if (flushTimeoutId !== null) {
    clearTimeout(flushTimeoutId);
    flushTimeoutId = null;
  }
  await enqueueOperation(async () => {
    await indexedDbInspectorLogStorage.clear();
    const nextId = state?.nextId ?? 1;
    state = { entries: [], nextId, totalSize: 0 };
    initialization = Promise.resolve(state);
    notify();
  });
};

export const downloadPersistentInspectorLogs = async (): Promise<number> => {
  await flushPendingRows();
  const currentState = await enqueueOperation(ensureState);
  const rows = getPersistentInspectorLogRows(currentState);
  const text = serializeInspectorLogsNdjson(rows);
  const blob = new Blob([text], { type: "application/x-ndjson;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `linky-inspector-logs-${new Date().toISOString().slice(0, 10)}.ndjson`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return rows.length;
};
