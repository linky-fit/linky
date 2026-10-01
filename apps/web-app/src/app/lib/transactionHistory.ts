import type { StoredOperation } from "@linky-fit/linkshu";
import {
  transactionIdForOperation,
  type MessageRow,
  type TransactionCategory,
  type TransactionDirection,
  type TransactionRecord,
  type TransactionStatus,
} from "@linky-fit/linksync";
import { Option, Schema } from "effect";
import { JsonValue } from "../../types/json";
import { isRecord } from "../../utils/unknown";
import { asNonEmptyString } from "../../utils/validation";
import {
  parseCashuPaymentRequestMessage,
  parseLinkyPaymentRequestDeclineMessage,
} from "./paymentRequestMessage";
import { createCashuTokenId } from "./cashuTokenIdentity";

/** Why a row stays out of the default history: no money moved, or another row records the same event. */
export type TransactionHiddenReason = "duplicate" | "failed";

export interface TransactionItem {
  amount: number | null;
  category: TransactionCategory;
  contactId: string | null;
  createdAtSec: number;
  details: JsonValue | null;
  direction: TransactionDirection;
  error: string | null;
  fee: number | null;
  hiddenReason: TransactionHiddenReason | null;
  id: string;
  /** Its send was taken back, wholly or in part; linkshu does not record which. */
  isReturned: boolean;
  method: string | null;
  mint: string | null;
  note: string | null;
  pendingLabel: string | null;
  status: TransactionStatus;
  unit: string | null;
}

const parseJsonValue = (value: string | null): JsonValue | null => {
  if (!value) return null;
  const result = Schema.decodeUnknownOption(Schema.parseJson(JsonValue))(value);
  return Option.getOrNull(result);
};

export const readJsonRecord = (
  value: JsonValue | null,
): Record<string, JsonValue> | null =>
  value !== null && isRecord(value) ? value : null;

export const readStringArrayFromJson = (
  value: JsonValue | null | undefined,
): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => asNonEmptyString(entry))
    .filter((entry): entry is string => entry !== null);
};

export const readRequestIdFromDetails = (
  details: JsonValue | null,
): string | null => {
  const detailRecord = readJsonRecord(details);
  return asNonEmptyString(detailRecord?.requestId);
};

export const readIssuedTokenFromDetails = (
  details: JsonValue | null,
): string | null => {
  const detailRecord = readJsonRecord(details);
  return asNonEmptyString(detailRecord?.issuedToken);
};

export const readTokenReferenceIds = (
  details: JsonValue | null,
  idKey: string,
  legacyTokenKey: string,
): string[] => {
  const detailRecord = readJsonRecord(details);
  const storedIds = readStringArrayFromJson(detailRecord?.[idKey]);
  const legacyTokens = readStringArrayFromJson(detailRecord?.[legacyTokenKey]);
  return Array.from(
    new Set([
      ...storedIds,
      ...legacyTokens.map((token) => createCashuTokenId(token)),
    ]),
  );
};

export const readIssuedTokenReferenceId = (
  details: JsonValue | null,
): string | null => {
  const detailRecord = readJsonRecord(details);
  const storedId = asNonEmptyString(detailRecord?.issuedTokenId);
  if (storedId) return storedId;
  const legacyToken = readIssuedTokenFromDetails(details);
  return legacyToken ? createCashuTokenId(legacyToken) : null;
};

const mergeDetailRecords = (
  primary: JsonValue | null,
  secondary: JsonValue | null,
): JsonValue | null => {
  const primaryRecord = readJsonRecord(primary);
  const secondaryRecord = readJsonRecord(secondary);

  if (!primaryRecord && !secondaryRecord) return null;

  return {
    ...(primaryRecord ?? {}),
    ...(secondaryRecord ?? {}),
  };
};

export const isPaymentRequestTransaction = (item: TransactionItem): boolean => {
  return (
    item.direction === "in" &&
    item.method === "cashu_chat" &&
    readRequestIdFromDetails(item.details) !== null
  );
};

/**
 * The mint's final answer on a quote. Transfers settle nothing: a send is
 * `done` once handed to the outbox, before any relay took the message.
 */
const settledQuoteStatus = (
  operation: StoredOperation,
): TransactionStatus | null => {
  if (operation.kind === "send" || operation.kind === "receive") return null;
  if (operation.status === "paid" || operation.status === "done") return "ok";
  if (operation.status === "unpaid" || operation.status === "failed")
    return "error";
  return null;
};

/** Finds the operation a row records: by its id, or for rows written before ids were derived, by quote, token or invoice. */
const makeOperationLookup = (operations: readonly StoredOperation[]) => {
  const byTransactionId = new Map<string, StoredOperation>();
  const byLegacyKey = new Map<string, StoredOperation>();
  for (const operation of operations) {
    byTransactionId.set(transactionIdForOperation(operation.id), operation);
    if (operation.kind === "melt" && operation.quoteId !== null)
      byLegacyKey.set(
        `quote:${operation.mint}|${operation.quoteId}`,
        operation,
      );
    if (operation.kind === "send" && operation.tokenText !== null)
      byLegacyKey.set(
        `token:${createCashuTokenId(operation.tokenText)}`,
        operation,
      );
    if (operation.kind === "melt" && operation.invoice !== null)
      byLegacyKey.set(`invoice:out:${operation.invoice}`, operation);
    if (operation.kind === "topup" && operation.invoice !== null)
      byLegacyKey.set(`invoice:in:${operation.invoice}`, operation);
  }

  return (
    id: string,
    direction: TransactionDirection,
    mint: string | null,
    details: JsonValue | null,
  ) => {
    const direct = byTransactionId.get(id);
    if (direct) return direct;
    const record = readJsonRecord(details);
    const meltQuoteId = asNonEmptyString(record?.meltQuoteId);
    const tokenIds = [
      readIssuedTokenReferenceId(details),
      ...readTokenReferenceIds(details, "usedTokenIds", "usedInputTokens"),
    ];
    const invoice = asNonEmptyString(record?.lightningInvoice);
    const keys = [
      meltQuoteId && mint ? `quote:${mint}|${meltQuoteId}` : null,
      ...tokenIds.map((tokenId) => (tokenId ? `token:${tokenId}` : null)),
      invoice ? `invoice:${direction}:${invoice}` : null,
    ];
    for (const key of keys) {
      const operation = key ? byLegacyKey.get(key) : undefined;
      if (operation) return operation;
    }
    return null;
  };
};

const toTransactionItem = (
  record: TransactionRecord,
  operation: StoredOperation | null,
): TransactionItem => ({
  amount: record.amount,
  category: record.category,
  contactId: record.contactId,
  createdAtSec: record.createdAtSec,
  details: parseJsonValue(record.detailsJson),
  direction: record.direction,
  error: asNonEmptyString(record.error),
  fee: record.fee,
  hiddenReason: null,
  id: record.id,
  isReturned: operation?.kind === "send" && operation.status === "returned",
  method: asNonEmptyString(record.method),
  mint: asNonEmptyString(record.mint),
  note: asNonEmptyString(record.note),
  pendingLabel: asNonEmptyString(record.pendingLabel),
  // A pending row follows its operation to the mint's final answer; a row a
  // receipt confirmed keeps its word.
  status:
    record.status === "pending"
      ? ((operation && settledQuoteStatus(operation)) ?? "pending")
      : record.status,
  unit: asNonEmptyString(record.unit),
});

const statusRank: Record<TransactionStatus, number> = {
  ok: 0,
  pending: 1,
  declined: 2,
  error: 2,
};

/** The row that best records an event: settled first, then with a contact, then the earliest. */
const isBetterRecord = (
  candidate: TransactionItem,
  current: TransactionItem,
): boolean => {
  const rankDiff = statusRank[candidate.status] - statusRank[current.status];
  if (rankDiff !== 0) return rankDiff < 0;
  if ((candidate.contactId === null) !== (current.contactId === null))
    return candidate.contactId !== null;
  return candidate.createdAtSec < current.createdAtSec;
};

const markHidden = (
  items: readonly TransactionItem[],
  eventKeyById: ReadonlyMap<string, string>,
): TransactionItem[] => {
  const recordByEventKey = new Map<string, TransactionItem>();
  for (const item of items) {
    const eventKey = eventKeyById.get(item.id);
    if (eventKey === undefined) continue;
    const current = recordByEventKey.get(eventKey);
    if (!current || isBetterRecord(item, current))
      recordByEventKey.set(eventKey, item);
  }

  return items.map((item): TransactionItem => {
    if (item.status === "error" || item.status === "declined")
      return { ...item, hiddenReason: "failed" };
    const eventKey = eventKeyById.get(item.id);
    if (eventKey !== undefined && recordByEventKey.get(eventKey) !== item)
      return { ...item, hiddenReason: "duplicate" };
    return item;
  });
};

/**
 * The history view over the repository's records and the wallet's
 * operations: sorted, pending rows settled by their operation, requests
 * paired with their fulfillment, emitted tokens folded into their spend.
 * Rows that are noise keep a `hiddenReason` instead of being dropped.
 */
export const buildTransactionHistory = (
  records: readonly TransactionRecord[],
  operations: readonly StoredOperation[],
): {
  fulfilledRequestIds: Set<string>;
  transactions: TransactionItem[];
} => {
  const operationFor = makeOperationLookup(operations);
  const eventKeyById = new Map<string, string>();
  const items = records.map((record) => {
    const operation = operationFor(
      record.id,
      record.direction,
      record.mint,
      parseJsonValue(record.detailsJson),
    );
    const item = toTransactionItem(record, operation);
    const gainedTokenId = readStringArrayFromJson(
      readJsonRecord(item.details)?.gainedTokenIds,
    )[0];
    // The gained token names one receipt across writers that derived
    // different ids for it (an older app version used random ids).
    const eventKey = gainedTokenId
      ? `gained:${gainedTokenId}`
      : operation
        ? `operation:${operation.id}`
        : undefined;
    if (eventKey !== undefined) eventKeyById.set(item.id, eventKey);
    return item;
  });
  items.sort((left, right) => {
    const createdAtDiff = right.createdAtSec - left.createdAtSec;
    if (createdAtDiff !== 0) return createdAtDiff;
    return right.id.localeCompare(left.id);
  });

  const requestByRequestId = new Map<string, TransactionItem>();
  const fulfillmentByRequestId = new Map<string, TransactionItem>();
  const emittedByToken = new Map<string, TransactionItem>();
  const spendByUsedToken = new Map<string, TransactionItem>();

  for (const item of items) {
    const requestId = readRequestIdFromDetails(item.details);
    if (!requestId) continue;

    if (isPaymentRequestTransaction(item)) {
      if (!requestByRequestId.has(requestId)) {
        requestByRequestId.set(requestId, item);
      }
      continue;
    }

    if (item.status !== "ok") continue;
    if (!fulfillmentByRequestId.has(requestId)) {
      fulfillmentByRequestId.set(requestId, item);
    }
  }

  for (const item of items) {
    if (item.status !== "ok") continue;

    const issuedTokenId = readIssuedTokenReferenceId(item.details);
    if (issuedTokenId && !emittedByToken.has(issuedTokenId)) {
      emittedByToken.set(issuedTokenId, item);
    }

    const usedTokenIds = readTokenReferenceIds(
      item.details,
      "usedTokenIds",
      "usedInputTokens",
    );
    for (const tokenId of usedTokenIds) {
      if (spendByUsedToken.has(tokenId)) continue;
      spendByUsedToken.set(tokenId, item);
    }
  }

  const folded = items.filter((item) => {
    const requestId = readRequestIdFromDetails(item.details);
    if (requestId) {
      if (isPaymentRequestTransaction(item)) {
        return requestByRequestId.get(requestId)?.id === item.id;
      }
      if (requestByRequestId.has(requestId)) return false;
      if (item.status === "ok") {
        return fulfillmentByRequestId.get(requestId)?.id === item.id;
      }
    }

    const issuedTokenId = readIssuedTokenReferenceId(item.details);
    if (!issuedTokenId) return true;
    return !spendByUsedToken.has(issuedTokenId);
  });

  const transactions = markHidden(folded, eventKeyById).map((item) => {
    let mergedItem = item;

    const usedTokenIds = readTokenReferenceIds(
      mergedItem.details,
      "usedTokenIds",
      "usedInputTokens",
    );
    for (const tokenId of usedTokenIds) {
      const emittedTransaction = emittedByToken.get(tokenId);
      if (!emittedTransaction || emittedTransaction.id === mergedItem.id) {
        continue;
      }
      mergedItem = {
        ...mergedItem,
        details: mergeDetailRecords(
          mergedItem.details,
          emittedTransaction.details,
        ),
      };
      break;
    }

    const requestId = readRequestIdFromDetails(item.details);
    if (!requestId || !isPaymentRequestTransaction(item)) {
      return mergedItem;
    }

    const fulfillment = fulfillmentByRequestId.get(requestId);
    if (!fulfillment) return mergedItem;

    return {
      ...mergedItem,
      details: mergeDetailRecords(mergedItem.details, fulfillment.details),
    };
  });

  return {
    fulfilledRequestIds: new Set(fulfillmentByRequestId.keys()),
    transactions,
  };
};

export const deriveDeclinedRequestIds = (
  nostrMessageRows: readonly Pick<
    MessageRow,
    "content" | "rumorId" | "createdAtSec"
  >[],
): Set<string> => {
  const requestIdByRumorId = new Map<string, string>();
  const latestDeclineAtByRequestId = new Map<string, number>();

  for (const row of nostrMessageRows) {
    const rumorId = asNonEmptyString(row.rumorId);
    const content = row.content ?? "";
    const requestInfo = parseCashuPaymentRequestMessage(content);
    const requestId = (requestInfo?.requestId ?? "").trim();

    if (rumorId && requestId) {
      requestIdByRumorId.set(rumorId, requestId);
    }
  }

  for (const row of nostrMessageRows) {
    const content = row.content ?? "";
    const declineInfo = parseLinkyPaymentRequestDeclineMessage(content);
    const requestRumorId = (declineInfo?.requestRumorId ?? "").trim();
    if (!requestRumorId) continue;

    const requestId = requestIdByRumorId.get(requestRumorId);
    if (!requestId) continue;

    const createdAtSec = row.createdAtSec;
    const previousCreatedAtSec = latestDeclineAtByRequestId.get(requestId);
    if (
      previousCreatedAtSec !== undefined &&
      createdAtSec !== null &&
      previousCreatedAtSec > createdAtSec
    ) {
      continue;
    }

    latestDeclineAtByRequestId.set(requestId, createdAtSec ?? 0);
  }

  return new Set(latestDeclineAtByRequestId.keys());
};
