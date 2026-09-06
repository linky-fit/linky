import { Option, Schema } from "effect";
import type { NostrMessageRow, TransactionRow } from "../../evolu";
import { JsonValue } from "../../types/json";
import { isRecord } from "../../utils/unknown";
import { asNonEmptyString } from "../../utils/validation";
import {
  parseCashuPaymentRequestMessage,
  parseLinkyPaymentRequestDeclineMessage,
} from "./paymentRequestMessage";
import { createCashuTokenId } from "./cashuTokenIdentity";
type TransactionStatus = "declined" | "error" | "ok" | "pending";

type TransactionDirection = "in" | "out";

export interface TransactionItem {
  amount: number | null;
  category: string;
  contactId: string | null;
  createdAtSec: number;
  details: JsonValue | null;
  direction: TransactionDirection;
  error: string | null;
  fee: number | null;
  id: string;
  method: string | null;
  mint: string | null;
  note: string | null;
  pendingLabel: string | null;
  phase: string | null;
  status: TransactionStatus;
  unit: string | null;
}

const readDirection = (value: string | null): TransactionDirection | null => {
  return value === "in" || value === "out" ? value : null;
};

const readStatus = (value: string | null): TransactionStatus | null => {
  return value === "declined" ||
    value === "error" ||
    value === "ok" ||
    value === "pending"
    ? value
    : null;
};

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

const deriveTransactionCategory = (
  method: string | null,
  legacyCategory: string | null,
): string => {
  if (method === "cashu_chat") return "contacts";
  if (method === "lightning_address" || method === "lightning_invoice") {
    return "lightning";
  }
  return legacyCategory || "cashu";
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

export const buildTransactionHistory = (
  transactionRows: readonly TransactionRow[],
  evoluAppOwnerId: string | null | undefined,
  evoluTransactionsVisibleOwnerIds: readonly (string | null | undefined)[],
): {
  fulfilledRequestIds: Set<string>;
  transactions: TransactionItem[];
} => {
  const items: TransactionItem[] = [];
  const visibleOwnerIds = new Set(
    [evoluAppOwnerId, ...evoluTransactionsVisibleOwnerIds]
      .map((ownerId) => asNonEmptyString(ownerId))
      .filter((ownerId): ownerId is string => ownerId !== null),
  );
  for (const row of transactionRows) {
    const ownerId = row.ownerId;
    if (ownerId && visibleOwnerIds.size > 0 && !visibleOwnerIds.has(ownerId)) {
      continue;
    }
    const id = row.id;
    const createdAtSec = row.createdAtSec;
    const direction = readDirection(row.direction);
    const status = readStatus(row.status);
    if (!id || !createdAtSec || !direction || !status) continue;
    const method = asNonEmptyString(row.method);
    items.push({
      amount: row.amount,
      category: deriveTransactionCategory(
        method,
        asNonEmptyString(row.category),
      ),
      contactId: row.contactId,
      createdAtSec,
      details: parseJsonValue(row.detailsJson),
      direction,
      error: asNonEmptyString(row.error),
      fee: row.fee,
      id,
      method,
      mint: asNonEmptyString(row.mint),
      note: asNonEmptyString(row.note),
      pendingLabel: asNonEmptyString(row.pendingLabel),
      phase: asNonEmptyString(row.phase),
      status,
      unit: asNonEmptyString(row.unit),
    });
  }
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

  const transactions = items
    .filter((item) => {
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
    })
    .map((item) => {
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
    NostrMessageRow,
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
