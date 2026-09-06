import { Schema } from "effect";
import { isLocalPaymentTelemetryEvent } from "./useAnonymousPaymentTelemetry";
import type { OwnerId } from "@evolu/common";
import React from "react";
import type { JsonValue } from "../../types/json";
import {
  LOCAL_PAYMENT_EVENTS_STORAGE_KEY_PREFIX,
  LOCAL_PENDING_PAYMENT_TELEMETRY_STORAGE_KEY_PREFIX,
} from "../../utils/constants";
import {
  CASHU_SEEN_MINTS_STORAGE_KEY,
  normalizeMintUrl,
} from "../../utils/mint";
import {
  createLocalPaymentTelemetryEvent,
  normalizePaymentTelemetryStatus,
} from "../lib/paymentTelemetry";
import { createCashuTokenId } from "../lib/cashuTokenIdentity";
import type {
  LocalPaymentEvent,
  LoggedPaymentEventParams,
} from "../types/appTypes";
import { isUnknownContactId } from "./messages/contactIdentity";
import {
  safeLocalStorageGet,
  safeLocalStorageGetJson,
  safeLocalStorageSet,
  safeLocalStorageSetJson,
} from "../../utils/storage";
import { isRecord } from "../../utils/unknown";
import { nowSeconds } from "../../utils/time";

type EvoluMutations = ReturnType<typeof import("../../evolu").useEvolu>;

type TransactionInsertPayload = {
  createdAtSec: number;
  detailsJson?: string;
  direction: "in" | "out";
  status: string;
  amount?: number;
  contactId?: string;
  error?: string;
  fee?: number;
  method?: string;
  mint?: string;
  unit?: string;
};

type TransactionEventLike = {
  amount?: number | null;
  contactId?: string | null;
  createdAtSec?: number | null;
  details?: JsonValue | null;
  direction: "in" | "out";
  error?: string | null;
  fee?: number | null;
  method?: string | null;
  mint?: string | null;
  note?: string | null;
  phase?: string | null;
  status: string;
  unit?: string | null;
};

const LEGACY_PAYMENT_EVENTS_MIGRATED_SUFFIX = ".migratedToEvolu.v2";

const serializeJsonValue = (
  value: JsonValue | null | undefined,
): string | null => {
  if (value === null || value === undefined) return null;
  try {
    const serialized = JSON.stringify(value);
    return serialized && serialized !== "null" ? serialized : null;
  } catch {
    return null;
  }
};

const readDetailString = (
  value: Record<string, unknown>,
  key: string,
): string | null => {
  const candidate = value[key];
  if (typeof candidate !== "string") return null;
  const trimmed = candidate.trim();
  return trimmed || null;
};

const readDetailStrings = (
  value: Record<string, unknown>,
  key: string,
): string[] => {
  const candidate = value[key];
  if (!Array.isArray(candidate)) return [];
  return candidate.flatMap((entry) => {
    if (typeof entry !== "string") return [];
    const trimmed = entry.trim();
    return trimmed ? [trimmed] : [];
  });
};

const compactTransactionDetails = (
  value: JsonValue | null | undefined,
): JsonValue | null => {
  if (!isRecord(value)) return null;

  const compact: Record<string, JsonValue> = {};
  const copyString = (key: string): void => {
    const text = readDetailString(value, key);
    if (text) compact[key] = text;
  };

  copyString("requestId");
  copyString("lightningInvoice");
  copyString("lightningPreimage");
  copyString("lnurlSuccessMessage");
  copyString("lnurlSuccessUrl");
  copyString("lnurlSuccessUrlDescription");

  const usedTokenIds = readDetailStrings(value, "usedInputTokens").map(
    (token) => createCashuTokenId(token),
  );
  if (usedTokenIds.length > 0) compact.usedTokenIds = usedTokenIds;

  const gainedTokenIds = [
    readDetailString(value, "gainedToken"),
    readDetailString(value, "acceptedToken"),
  ].flatMap((token) => (token ? [createCashuTokenId(token)] : []));
  if (gainedTokenIds.length > 0) {
    compact.gainedTokenIds = Array.from(new Set(gainedTokenIds));
  }

  const issuedToken = readDetailString(value, "issuedToken");
  if (issuedToken) {
    compact.issuedTokenId = createCashuTokenId(issuedToken);
  }

  return Object.keys(compact).length > 0 ? compact : null;
};

const isLegacyPaymentEvent = (value: unknown): value is LocalPaymentEvent => {
  if (!isRecord(value)) return false;
  if (value.direction !== "in" && value.direction !== "out") return false;
  if (
    value.status !== "ok" &&
    value.status !== "error" &&
    value.status !== "declined"
  ) {
    return false;
  }

  const createdAtSec = Number(value.createdAtSec);
  return Number.isFinite(createdAtSec) && createdAtSec > 0;
};

export const buildTransactionInsertPayload = (args: {
  createdAtSec: number;
  event: TransactionEventLike;
}): TransactionInsertPayload => {
  const amount =
    typeof args.event.amount === "number" && args.event.amount > 0
      ? Math.floor(args.event.amount)
      : null;
  // `transaction.fee` is `nullOr(PositiveInt)`, so 0 is NOT valid. A `fee: 0`
  // payload fails schema validation, and because Evolu batches every mutation
  // issued in the same microtask into one transaction, a single invalid
  // mutation silently drops the whole batch — including the cashu token
  // insert/delete issued alongside it (e.g. Lightning melt with feePaid === 0).
  // Treat a zero fee as "no fee" and omit it.
  const fee =
    typeof args.event.fee === "number" && args.event.fee > 0
      ? Math.floor(args.event.fee)
      : null;
  const mint = (args.event.mint ?? "").trim();
  const unit = (args.event.unit ?? "").trim();
  const error = (args.event.error ?? "").trim();
  const status = normalizePaymentTelemetryStatus({
    error: args.event.error,
    status:
      args.event.status === "ok" ||
      args.event.status === "error" ||
      args.event.status === "declined"
        ? args.event.status
        : "error",
  });

  const method = (args.event.method ?? "").trim();
  const phase = (args.event.phase ?? "").trim();
  const storedMethod =
    method === "unknown" && phase === "swap" ? "cashu_emit" : method;
  const transactionStatus =
    status === "ok" && phase === "publish" ? "pending" : status;

  const payload: TransactionInsertPayload = {
    createdAtSec: args.createdAtSec,
    direction: args.event.direction,
    status: transactionStatus,
  };

  const contactId = (args.event.contactId ?? "").trim();
  const storedContactId = isUnknownContactId(contactId) ? "" : contactId;
  const detailsJson = serializeJsonValue(
    compactTransactionDetails(args.event.details),
  );

  if (amount !== null) payload.amount = amount;
  if (fee !== null) payload.fee = fee;
  if (mint) payload.mint = mint;
  if (unit) payload.unit = unit;
  if (error) payload.error = error.slice(0, 1000);
  if (storedContactId) payload.contactId = storedContactId;
  if (detailsJson) payload.detailsJson = detailsJson;
  if (storedMethod) payload.method = storedMethod;

  return payload;
};

interface UseOwnerScopedStorageParams {
  appOwnerIdRef: React.MutableRefObject<OwnerId | null>;
  insert: EvoluMutations["insert"];
  transactionsOwnerIdRef: React.MutableRefObject<OwnerId | null>;
}

interface UseOwnerScopedStorageResult {
  logPaymentEvent: (event: LoggedPaymentEventParams) => void;
  makeLocalStorageKey: (prefix: string) => string;
  migrateLegacyPaymentEventsToEvolu: (
    ownerId: OwnerId,
    transactionOwnerId: OwnerId | null,
  ) => void;
  readSeenMintsFromStorage: () => string[];
  rememberSeenMint: (mintUrl: string | null | undefined) => void;
}

export const useOwnerScopedStorage = ({
  appOwnerIdRef,
  insert,
  transactionsOwnerIdRef,
}: UseOwnerScopedStorageParams): UseOwnerScopedStorageResult => {
  const migratedLegacyPaymentsKeyRef = React.useRef<string | null>(null);

  const makeLocalStorageKey = React.useCallback(
    (prefix: string): string => {
      const ownerId = appOwnerIdRef.current;
      return `${prefix}.${ownerId ?? "anon"}`;
    },
    [appOwnerIdRef],
  );

  const readSeenMintsFromStorage = React.useCallback(
    (): string[] =>
      safeLocalStorageGetJson(
        makeLocalStorageKey(CASHU_SEEN_MINTS_STORAGE_KEY),
        Schema.Array(Schema.String),
        [],
      )
        .map((value) => normalizeMintUrl(value))
        .filter(Boolean),
    [makeLocalStorageKey],
  );

  const rememberSeenMint = React.useCallback(
    (mintUrl: string | null | undefined): void => {
      const cleaned = normalizeMintUrl(mintUrl);
      if (!cleaned) return;
      const existing = new Set(readSeenMintsFromStorage());
      existing.add(cleaned);
      safeLocalStorageSetJson(
        makeLocalStorageKey(CASHU_SEEN_MINTS_STORAGE_KEY),
        Array.from(existing).slice(0, 50),
      );
    },
    [makeLocalStorageKey, readSeenMintsFromStorage],
  );

  const logPaymentEvent = React.useCallback(
    (event: LoggedPaymentEventParams) => {
      const ownerId = appOwnerIdRef.current ?? transactionsOwnerIdRef.current;
      if (!ownerId) return;

      const nowSec = nowSeconds();
      const transactionPayload = buildTransactionInsertPayload({
        createdAtSec: nowSec,
        event: {
          amount: event.amount ?? null,
          contactId: event.contactId ? event.contactId : null,
          details: event.details ?? null,
          direction: event.direction,
          error: event.error ?? null,
          fee: event.fee ?? null,
          method: event.method ?? null,
          mint: event.mint ?? null,
          note: event.note ?? null,
          phase: event.phase ?? null,
          status: event.status,
          unit: event.unit ?? null,
        },
      });

      const transactionOwnerId = transactionsOwnerIdRef.current ?? ownerId;
      try {
        if (transactionOwnerId) {
          insert("transaction", transactionPayload, {
            ownerId: transactionOwnerId,
          });
        } else {
          insert("transaction", transactionPayload);
        }
      } catch {
        // Transaction history must never break payment receive/send flows.
      }

      const telemetryEntry = createLocalPaymentTelemetryEvent(event, nowSec);
      const telemetryQueue = safeLocalStorageGetJson(
        makeLocalStorageKey(LOCAL_PENDING_PAYMENT_TELEMETRY_STORAGE_KEY_PREFIX),
        Schema.Array(Schema.Unknown),
        [],
      ).filter(isLocalPaymentTelemetryEvent);
      const nextTelemetryQueue = [telemetryEntry, ...telemetryQueue].slice(
        0,
        250,
      );
      safeLocalStorageSetJson(
        makeLocalStorageKey(LOCAL_PENDING_PAYMENT_TELEMETRY_STORAGE_KEY_PREFIX),
        nextTelemetryQueue,
      );
    },
    [appOwnerIdRef, insert, makeLocalStorageKey, transactionsOwnerIdRef],
  );

  const migrateLegacyPaymentEventsToEvolu = React.useCallback(
    (ownerId: OwnerId, transactionOwnerId: OwnerId | null) => {
      const legacyStorageKey = `${LOCAL_PAYMENT_EVENTS_STORAGE_KEY_PREFIX}.${ownerId}`;
      const migratedKey = `${legacyStorageKey}${LEGACY_PAYMENT_EVENTS_MIGRATED_SUFFIX}`;

      if (migratedLegacyPaymentsKeyRef.current === migratedKey) return;

      if (safeLocalStorageGet(migratedKey) === "1") {
        migratedLegacyPaymentsKeyRef.current = migratedKey;
        return;
      }

      const legacyItems = safeLocalStorageGetJson(
        legacyStorageKey,
        Schema.Array(Schema.Unknown),
        [],
      );
      if (legacyItems.length === 0) {
        safeLocalStorageSet(migratedKey, "1");
        migratedLegacyPaymentsKeyRef.current = migratedKey;
        return;
      }

      const writeOwnerId = transactionOwnerId ?? ownerId;

      for (const legacyItem of legacyItems) {
        if (!isLegacyPaymentEvent(legacyItem)) continue;

        const transactionPayload = buildTransactionInsertPayload({
          createdAtSec: Math.trunc(legacyItem.createdAtSec),
          event: legacyItem,
        });

        try {
          if (writeOwnerId) {
            insert("transaction", transactionPayload, {
              ownerId: writeOwnerId,
            });
          } else {
            insert("transaction", transactionPayload);
          }
        } catch {
          // ignore legacy migration failures and keep payment flows unaffected
        }
      }

      safeLocalStorageSet(migratedKey, "1");
      migratedLegacyPaymentsKeyRef.current = migratedKey;
    },
    [insert],
  );

  return {
    logPaymentEvent,
    makeLocalStorageKey,
    migrateLegacyPaymentEventsToEvolu,
    readSeenMintsFromStorage,
    rememberSeenMint,
  };
};
