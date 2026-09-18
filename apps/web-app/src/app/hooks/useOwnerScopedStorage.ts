import {
  ContactId,
  createId,
  NonEmptyString,
  NonEmptyString100,
  NonEmptyString1000,
  PositiveInt,
  type LinkyDbSchema,
  type TransactionsRepository,
  type WriteRow,
} from "@linky/linksync";
import { Effect, Schema } from "effect";
import React from "react";
import { isLocalPaymentTelemetryEvent } from "./useAnonymousPaymentTelemetry";
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

type TransactionInsertPayload = {
  -readonly [K in keyof Omit<
    WriteRow<LinkyDbSchema["transaction"]>,
    "id"
  >]: WriteRow<LinkyDbSchema["transaction"]>[K];
};

interface ColumnType<Input, Value> {
  readonly from: (
    value: Input,
  ) => { readonly ok: true; readonly value: Value } | { readonly ok: false };
}

/** The column value, or undefined when the input does not fit the column (the payload then omits it). */
const columnOrOmit = <Input, Value>(
  type: ColumnType<Input, Value>,
  value: Input,
): Value | undefined => {
  const result = type.from(value);
  return result.ok ? result.value : undefined;
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
  copyString("meltQuoteId");
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
  // An `ok` publish (token sent, delivery unconfirmed) or melt (request sent,
  // mint undecided) step is a payment still in flight.
  const transactionStatus =
    status === "ok" && (phase === "publish" || phase === "melt")
      ? "pending"
      : status;

  const payload: TransactionInsertPayload = {
    createdAtSec: PositiveInt.orThrow(args.createdAtSec),
    direction: NonEmptyString100.orThrow(args.event.direction),
    status: NonEmptyString100.orThrow(transactionStatus),
  };

  const contactId = (args.event.contactId ?? "").trim();
  const storedContactId = isUnknownContactId(contactId)
    ? undefined
    : columnOrOmit(ContactId, contactId);
  const detailsJson = serializeJsonValue(
    compactTransactionDetails(args.event.details),
  );

  const optional = {
    amount: amount === null ? undefined : PositiveInt.orThrow(amount),
    fee: fee === null ? undefined : PositiveInt.orThrow(fee),
    mint: columnOrOmit(NonEmptyString1000, mint),
    unit: columnOrOmit(NonEmptyString100, unit),
    error: columnOrOmit(NonEmptyString1000, error.slice(0, 1000)),
    contactId: storedContactId,
    detailsJson: columnOrOmit(NonEmptyString, detailsJson ?? ""),
    method: columnOrOmit(NonEmptyString100, storedMethod),
  };
  if (optional.amount !== undefined) payload.amount = optional.amount;
  if (optional.fee !== undefined) payload.fee = optional.fee;
  if (optional.mint !== undefined) payload.mint = optional.mint;
  if (optional.unit !== undefined) payload.unit = optional.unit;
  if (optional.error !== undefined) payload.error = optional.error;
  if (optional.contactId !== undefined) payload.contactId = optional.contactId;
  if (optional.detailsJson !== undefined)
    payload.detailsJson = optional.detailsJson;
  if (optional.method !== undefined) payload.method = optional.method;

  return payload;
};

interface UseOwnerScopedStorageParams {
  appOwnerIdRef: React.MutableRefObject<string | null>;
  transactions: Pick<TransactionsRepository, "insert">;
}

interface UseOwnerScopedStorageResult {
  logPaymentEvent: (event: LoggedPaymentEventParams) => void;
  makeLocalStorageKey: (prefix: string) => string;
  migrateLegacyPaymentEventsToEvolu: (ownerId: string) => void;
  readSeenMintsFromStorage: () => string[];
  rememberSeenMint: (mintUrl: string | null | undefined) => void;
}

export const useOwnerScopedStorage = ({
  appOwnerIdRef,
  transactions,
}: UseOwnerScopedStorageParams): UseOwnerScopedStorageResult => {
  const migratedLegacyPaymentsKeyRef = React.useRef<string | null>(null);

  // Transaction history must never break payment receive/send flows.
  const insertTransaction = React.useCallback(
    (payload: TransactionInsertPayload): void => {
      void Effect.runPromise(
        transactions.insert({ id: createId<"Transaction">(), ...payload }),
      ).catch((error: unknown) => {
        console.warn("[linky][transactions] insert failed", error);
      });
    },
    [transactions],
  );

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
      if (!appOwnerIdRef.current) return;

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

      insertTransaction(transactionPayload);

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
    [appOwnerIdRef, insertTransaction, makeLocalStorageKey],
  );

  const migrateLegacyPaymentEventsToEvolu = React.useCallback(
    (ownerId: string) => {
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

      for (const legacyItem of legacyItems) {
        if (!isLegacyPaymentEvent(legacyItem)) continue;
        insertTransaction(
          buildTransactionInsertPayload({
            createdAtSec: Math.trunc(legacyItem.createdAtSec),
            event: legacyItem,
          }),
        );
      }

      safeLocalStorageSet(migratedKey, "1");
      migratedLegacyPaymentsKeyRef.current = migratedKey;
    },
    [insertTransaction],
  );

  return {
    logPaymentEvent,
    makeLocalStorageKey,
    migrateLegacyPaymentEventsToEvolu,
    readSeenMintsFromStorage,
    rememberSeenMint,
  };
};
