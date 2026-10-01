import {
  safeSessionStorageGet,
  safeSessionStorageSet,
} from "../../utils/storage";
import type { JsonRecord, JsonValue } from "../../types/json";
import { getUnknownErrorMessage } from "../../utils/unknown";
import { clientInspectorStore } from "./clientInspectorStore";
import {
  getInspectorEnabled,
  getInspectorLogsEnabled,
} from "./inspectorEnabled";
import { INSPECTOR_REPORT_PATH } from "./inspectorRows";
import type { InspectorRow } from "./inspectorRows";

// App side of the inspector: prepare each row once, then fan it out to every
// active sink. Production builds have no HTTP reporting path.

const FLUSH_DELAY_MS = 250;
const MAX_PENDING_ROWS = 1_000;
const FAILURE_BACKOFF_MS = 5_000;
const MAX_PAYLOAD_STRING_LENGTH = 10_000;
const MAX_PAYLOAD_ARRAY_LENGTH = 500;
const MAX_PAYLOAD_DEPTH = 10;

let cachedClientId: string | null = null;

// Per-tab app instance id: sessionStorage keeps it stable across reloads of
// one tab while giving every tab its own value, so the inspector can tell app
// tabs apart.
const getClientId = (): string => {
  if (cachedClientId !== null) return cachedClientId;
  cachedClientId =
    safeSessionStorageGet("linky.inspector_client_id") ?? crypto.randomUUID();
  safeSessionStorageSet("linky.inspector_client_id", cachedClientId);
  return cachedClientId;
};

// Payloads come from arbitrary linkstr events; collapse whatever
// JSON.stringify would choke on (or bloat on) before buffering.
const toJsonSafe = (value: unknown, depth: number): JsonValue => {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === "string") {
    if (value.length <= MAX_PAYLOAD_STRING_LENGTH) return value;
    return `${value.slice(0, MAX_PAYLOAD_STRING_LENGTH)}…(+${value.length - MAX_PAYLOAD_STRING_LENGTH} chars)`;
  }
  if (value instanceof Uint8Array) return `Uint8Array(${value.length})`;
  if (value instanceof Error) {
    return { name: value.name, message: getUnknownErrorMessage(value, "") };
  }
  if (depth >= MAX_PAYLOAD_DEPTH) return "…(max depth)";
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_PAYLOAD_ARRAY_LENGTH)
      .map((entry) => toJsonSafe(entry, depth + 1));
    if (value.length > MAX_PAYLOAD_ARRAY_LENGTH) {
      items.push(`…(+${value.length - MAX_PAYLOAD_ARRAY_LENGTH} more)`);
    }
    return items;
  }
  if (typeof value === "object") {
    const out: JsonRecord = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined) continue;
      out[key] = toJsonSafe(entry, depth + 1);
    }
    return out;
  }
  return String(value);
};

const pendingRows: InspectorRow[] = [];
let flushTimeoutId: ReturnType<typeof setTimeout> | null = null;
let backoffUntilMs = 0;

const flushPendingRows = (): void => {
  flushTimeoutId = null;
  if (pendingRows.length === 0) return;
  if (Date.now() < backoffUntilMs) {
    scheduleFlush();
    return;
  }

  const rows = pendingRows.splice(0);
  void fetch(INSPECTOR_REPORT_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client: getClientId(), rows }),
  }).catch(() => {
    // Collector unreachable (e.g. served without the dev middleware): back
    // off and drop this batch instead of buffering forever.
    backoffUntilMs = Date.now() + FAILURE_BACKOFF_MS;
  });
};

const scheduleFlush = (): void => {
  if (flushTimeoutId !== null) return;
  flushTimeoutId = setTimeout(flushPendingRows, FLUSH_DELAY_MS);
};

export const reportInspectorRows = (rows: InspectorRow[]): void => {
  if (rows.length === 0) return;

  const preparedRows = rows.map(
    (row): InspectorRow => ({
      ...row,
      payload: toJsonSafe(row.payload, 0),
    }),
  );
  const clientId = getClientId();
  if (getInspectorEnabled()) {
    clientInspectorStore.append(clientId, preparedRows);
  }

  if (getInspectorLogsEnabled()) {
    void import("./persistentInspectorLogSink")
      .then(({ appendPersistentInspectorLogs }) =>
        appendPersistentInspectorLogs(clientId, preparedRows),
      )
      .catch(() => undefined);
  }

  // Rows hold decrypted plaintext, so they may leave the device only in dev.
  if (!import.meta.env.DEV) return;

  pendingRows.push(...preparedRows);
  if (pendingRows.length > MAX_PENDING_ROWS) {
    pendingRows.splice(0, pendingRows.length - MAX_PENDING_ROWS);
  }
  scheduleFlush();
};
