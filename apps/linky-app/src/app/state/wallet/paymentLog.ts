import {
  ContactId,
  createId,
  NonEmptyString,
  NonEmptyString100,
  NonEmptyString1000,
  PositiveInt,
  type LinkyDbSchema,
  type Patch,
  type TransactionId,
  type TransactionRow,
  type TransactionsRepository,
  type WriteRow,
} from "@linky-fit/linksync";
import type { KeyValueStorage } from "@linky-fit/linksync/evolu";
import { Effect, Option, Schema } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import { JsonValue } from "../../../types/json";
import {
  LOCAL_PAYMENT_EVENTS_STORAGE_KEY_PREFIX,
  LOCAL_PENDING_PAYMENT_TELEMETRY_STORAGE_KEY_PREFIX,
} from "../../../utils/constants";
import { readKvJson, writeKvJson } from "../../../utils/storage";
import { nowSeconds } from "../../../utils/time";
import { isRecord } from "../../../utils/unknown";
import { isUnknownContactId } from "../../hooks/messages/contactIdentity";
import { createCashuTokenId } from "../../lib/cashuTokenIdentity";
import {
  createLocalPaymentTelemetryEvent,
  isLocalPaymentTelemetryEvent,
  normalizePaymentTelemetryStatus,
} from "../../lib/paymentTelemetry";
import type {
  LocalPaymentEvent,
  LoggedPaymentEventParams,
  PaymentLogData,
} from "../../types/appTypes";
import { reportAppLog } from "../../../devtools/inspector/appLog";
import { platformAtom } from "../platform";
import { appOwnerIdAtom, transactionsRepositoryAtom } from "../session/store";
import { ownerStorageKey } from "./ownerStorage";

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

interface TransactionEventLike {
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
}

// removal gate in app/migrations/AGENTS.md
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

const readDetailPositiveInt = (
  value: Record<string, unknown>,
  key: string,
): number | null => {
  const candidate = value[key];
  if (typeof candidate !== "number" || !Number.isInteger(candidate))
    return null;
  return candidate > 0 ? candidate : null;
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
  copyString("lightningAddress");
  copyString("lightningInvoice");
  copyString("lightningPreimage");
  copyString("meltQuoteId");
  copyString("lnurlSuccessMessage");
  copyString("lnurlSuccessUrl");
  copyString("lnurlSuccessUrlDescription");
  copyString("recurringPaymentId");
  const recurringDueAtSec = readDetailPositiveInt(value, "recurringDueAtSec");
  if (recurringDueAtSec !== null) compact.recurringDueAtSec = recurringDueAtSec;

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
  const note = (args.event.note ?? "").trim();
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
    note: columnOrOmit(NonEmptyString1000, note.slice(0, 1000)),
    contactId: storedContactId,
    detailsJson: columnOrOmit(NonEmptyString, detailsJson ?? ""),
    method: columnOrOmit(NonEmptyString100, storedMethod),
  };
  if (optional.amount !== undefined) payload.amount = optional.amount;
  if (optional.fee !== undefined) payload.fee = optional.fee;
  if (optional.mint !== undefined) payload.mint = optional.mint;
  if (optional.unit !== undefined) payload.unit = optional.unit;
  if (optional.error !== undefined) payload.error = optional.error;
  if (optional.note !== undefined) payload.note = optional.note;
  if (optional.contactId !== undefined) payload.contactId = optional.contactId;
  if (optional.detailsJson !== undefined)
    payload.detailsJson = optional.detailsJson;
  if (optional.method !== undefined) payload.method = optional.method;

  return payload;
};

const decodeDetails = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Record(Schema.String, JsonValue)),
);

const readDetails = (json: string | null | undefined) =>
  json ? Option.getOrElse(decodeDetails(json), () => ({})) : {};

/** A later write of one event adds what it knows; it never moves the event time or takes back a confirmed status. */
export const mergeTransactionWrite = (
  existing: TransactionRow,
  payload: TransactionInsertPayload,
): Patch<LinkyDbSchema["transaction"]> => {
  const { detailsJson, status, ...columns } = payload;
  const details = {
    ...readDetails(existing.detailsJson),
    ...readDetails(detailsJson),
  };
  return {
    ...columns,
    createdAtSec: existing.createdAtSec ?? columns.createdAtSec,
    ...(existing.status === "ok" ? {} : { status }),
    ...(detailsJson === undefined
      ? {}
      : { detailsJson: NonEmptyString.orThrow(JSON.stringify(details)) }),
  };
};

/** An app log row for one step of a contact payment. */
export const logPayStep = (step: string, data?: PaymentLogData): void => {
  const clientId = data?.clientId;
  const messageId = data?.messageId;
  reportAppLog({
    tag: "pay.step",
    summary: `Contact payment: ${step}`,
    links: {
      ...(typeof clientId === "string" ? { client: clientId } : {}),
      ...(typeof messageId === "string" ? { message: messageId } : {}),
    },
    payload: { step, ...data },
  });
};

export interface PaymentLog {
  /**
   * Records a payment step: an `ok` step becomes (or extends) its transaction
   * row, every step queues anonymous telemetry. Never throws; history must
   * not break a payment.
   */
  readonly logPaymentEvent: (event: LoggedPaymentEventParams) => void;
  /** Copies the pre-Evolu localStorage payment history once per owner. */
  readonly migrateLegacyPaymentEvents: () => void;
}

export const makePaymentLog = ({
  kv,
  ownerId,
  transactions,
}: {
  readonly kv: KeyValueStorage;
  readonly ownerId: string;
  readonly transactions: Pick<
    TransactionsRepository,
    "byId" | "insert" | "update"
  >;
}): PaymentLog => {
  const insertTransaction = (
    id: TransactionId,
    payload: TransactionInsertPayload,
  ): void => {
    const write = Effect.flatMap(transactions.byId(id), (existing) =>
      existing === null
        ? transactions.insert({ id, ...payload })
        : transactions.update(id, mergeTransactionWrite(existing, payload)),
    );
    void Effect.runPromise(write).catch((error: unknown) => {
      console.warn("[linky][transactions] insert failed", error);
    });
  };
  const telemetryKey = ownerStorageKey(
    LOCAL_PENDING_PAYMENT_TELEMETRY_STORAGE_KEY_PREFIX,
    ownerId,
  );
  let legacyMigrated = false;

  const logEvent = (event: LoggedPaymentEventParams): void => {
    const nowSec = nowSeconds();
    if (event.status === "ok") {
      insertTransaction(
        event.transactionId,
        buildTransactionInsertPayload({
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
        }),
      );
    }

    const queue = readKvJson(
      kv,
      telemetryKey,
      Schema.Array(Schema.Unknown),
      [],
    ).filter(isLocalPaymentTelemetryEvent);
    writeKvJson(
      kv,
      telemetryKey,
      [createLocalPaymentTelemetryEvent(event, nowSec), ...queue].slice(0, 250),
    );
  };

  return {
    logPaymentEvent: (event) => {
      try {
        logEvent(event);
      } catch (error) {
        console.warn("[linky][transactions] payment log failed", error);
      }
    },
    migrateLegacyPaymentEvents: () => {
      if (legacyMigrated) return;
      legacyMigrated = true;
      const legacyStorageKey = ownerStorageKey(
        LOCAL_PAYMENT_EVENTS_STORAGE_KEY_PREFIX,
        ownerId,
      );
      const migratedKey = `${legacyStorageKey}${LEGACY_PAYMENT_EVENTS_MIGRATED_SUFFIX}`;
      if (kv.getItem(migratedKey) === "1") return;

      const legacyItems = readKvJson(
        kv,
        legacyStorageKey,
        Schema.Array(Schema.Unknown),
        [],
      );
      for (const legacyItem of legacyItems) {
        if (!isLegacyPaymentEvent(legacyItem)) continue;
        insertTransaction(
          createId<"Transaction">(),
          buildTransactionInsertPayload({
            createdAtSec: Math.trunc(legacyItem.createdAtSec),
            event: legacyItem,
          }),
        );
      }
      kv.setItem(migratedKey, "1");
    },
  };
};

/** The session owner's payment history and telemetry queue. */
export const paymentLogAtom = Atom.keepAlive(
  Atom.readable((get) =>
    AsyncResult.map(
      AsyncResult.all({
        ownerId: get(appOwnerIdAtom),
        transactions: get(transactionsRepositoryAtom),
      }),
      ({ ownerId, transactions }) =>
        makePaymentLog({ kv: get(platformAtom).kv, ownerId, transactions }),
    ),
  ),
);
