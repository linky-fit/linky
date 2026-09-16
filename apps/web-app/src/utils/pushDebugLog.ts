import { Option, Schema } from "effect";
import { isRecord } from "./unknown";
import type { JsonRecord, JsonValue } from "../types/json";
import { redactDiagnosticText } from "./bootDiagnosticRedaction";
import { sleep } from "./time";

const PUSH_DEBUG_CACHE_NAME = "linky-push-debug-v1";
const PUSH_DEBUG_LOG_URL = "/__debug__/push-log.json";
const PUSH_DEBUG_LOG_LIMIT = 100;
const PUSH_DEBUG_LOG_BATCH_DELAY_MS = 50;
const REDACTED = "[redacted]";
const IDENTITY_KEY_PATTERN = /(pub|pubkey|npub|nsec)s?$/i;
const BARE_HEX_64_PATTERN = /^[0-9a-f]{64}$/i;
const PUBKEY_FINGERPRINT_LENGTH = 8;
const pendingPushDebugEntries: PushDebugLogEntry[] = [];
let pushDebugLogFlushPromise: Promise<void> | null = null;

export interface PushDebugLogEntry {
  details?: JsonValue;
  message: string;
  source: string;
  timestamp: string;
}

const StoredPushDebugLogEntry = Schema.Struct({
  details: Schema.optional(Schema.Unknown),
  message: Schema.String,
  source: Schema.String,
  timestamp: Schema.String,
});
const decodeStoredPushDebugLogEntry = Schema.decodeUnknownOption(
  StoredPushDebugLogEntry,
);

export function fingerprintPubkey(value: string | null): string | null {
  return value === null ? null : value.slice(0, PUBKEY_FINGERPRINT_LENGTH);
}

function redactText(value: string): string {
  return BARE_HEX_64_PATTERN.test(value) ? value : redactDiagnosticText(value);
}

function redactIdentityValue(value: unknown): JsonValue {
  if (typeof value === "string") {
    return REDACTED;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactIdentityValue(entry));
  }

  if (isRecord(value)) {
    const out: JsonRecord = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = redactIdentityValue(entry);
    }
    return out;
  }

  return normalizeJsonValue(value);
}

function normalizeJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }

  if (typeof value === "string") {
    return redactText(value);
  }

  if (value instanceof Error) {
    return {
      message: redactText(value.message),
      name: value.name,
      stack: value.stack === undefined ? null : redactText(value.stack),
    };
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeJsonValue(entry));
  }

  if (isRecord(value)) {
    const out: JsonRecord = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = IDENTITY_KEY_PATTERN.test(key)
        ? redactIdentityValue(entry)
        : normalizeJsonValue(entry);
    }
    return out;
  }

  return String(value);
}

async function readStoredLog(): Promise<PushDebugLogEntry[]> {
  const cache = await caches.open(PUSH_DEBUG_CACHE_NAME);
  const response = await cache.match(PUSH_DEBUG_LOG_URL);
  if (!response) {
    return [];
  }

  try {
    const json: unknown = await response.json();
    if (!Array.isArray(json)) {
      return [];
    }

    const entries: PushDebugLogEntry[] = [];
    for (const entry of json) {
      const decoded = decodeStoredPushDebugLogEntry(entry);
      if (Option.isNone(decoded)) continue;
      const { details, ...rest } = decoded.value;
      entries.push({
        ...rest,
        ...(details === undefined
          ? {}
          : { details: normalizeJsonValue(details) }),
      });
    }
    return entries;
  } catch {
    return [];
  }
}

async function writeStoredLog(entries: PushDebugLogEntry[]): Promise<void> {
  const cache = await caches.open(PUSH_DEBUG_CACHE_NAME);
  await cache.put(
    PUSH_DEBUG_LOG_URL,
    new Response(JSON.stringify(entries), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    }),
  );
}

function schedulePushDebugLogFlush(): Promise<void> {
  if (pushDebugLogFlushPromise) return pushDebugLogFlushPromise;

  pushDebugLogFlushPromise = sleep(PUSH_DEBUG_LOG_BATCH_DELAY_MS)
    .then(async () => {
      const nextEntries = pendingPushDebugEntries.splice(0);
      if (nextEntries.length === 0) return;

      try {
        const existing = await readStoredLog();
        await writeStoredLog(
          [...nextEntries.reverse(), ...existing].slice(
            0,
            PUSH_DEBUG_LOG_LIMIT,
          ),
        );
      } catch {
        // Ignore debug logging failures.
      }
    })
    .finally(() => {
      pushDebugLogFlushPromise = null;
      if (pendingPushDebugEntries.length > 0) {
        void schedulePushDebugLogFlush();
      }
    });

  return pushDebugLogFlushPromise;
}

export function appendPushDebugLog(
  source: string,
  message: string,
  details?: unknown,
): void {
  if (!("caches" in globalThis)) {
    return;
  }

  pendingPushDebugEntries.push({
    message,
    source,
    timestamp: new Date().toISOString(),
    ...(details === undefined ? {} : { details: normalizeJsonValue(details) }),
  });

  void schedulePushDebugLogFlush();
}

/** Resolves once every entry appended so far has been written. */
export function flushPushDebugLog(): Promise<void> {
  return pushDebugLogFlushPromise ?? Promise.resolve();
}

export async function readPushDebugLog(): Promise<PushDebugLogEntry[]> {
  if (!("caches" in globalThis)) {
    return [];
  }

  await flushPushDebugLog();
  return readStoredLog();
}

export async function clearPushDebugLog(): Promise<void> {
  if (!("caches" in globalThis)) {
    return;
  }

  try {
    pendingPushDebugEntries.length = 0;
    await flushPushDebugLog();
    const cache = await caches.open(PUSH_DEBUG_CACHE_NAME);
    await cache.delete(PUSH_DEBUG_LOG_URL);
  } catch {
    // Ignore debug logging failures.
  }
}
