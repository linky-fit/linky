const commonColumns = new Set([
  "id",
  "ownerId",
  "createdAt",
  "updatedAt",
  "isDeleted",
  "createdAtSec",
]);

const tableColumns = new Map<string, ReadonlySet<string>>([
  [
    "contact",
    new Set([
      "npub",
      "nameSetByUser",
      "lnAddressSetByUser",
      "archivedAtSec",
      "chatLastSeenAtSec",
      "chatPeerSeenSinceSec",
      "chatPeerSeenAtSec",
    ]),
  ],
  ["nostrIdentity", new Set(["npub", "source", "switchedAtSec"])],
  [
    "nostrMessage",
    new Set([
      "contactId",
      "direction",
      "wrapId",
      "rumorId",
      "pubkey",
      "clientId",
      "status",
      "localOnly",
      "replyToId",
      "rootMessageId",
      "editedAtSec",
      "editedFromId",
      "isEdited",
    ]),
  ],
  [
    "nostrReaction",
    new Set(["messageId", "reactorPubkey", "wrapId", "clientId", "status"]),
  ],
  ["cashuToken", new Set(["mint", "unit", "amount", "state"])],
  [
    "cashuProof",
    new Set(["mint", "unit", "keysetId", "amount", "state", "operationId"]),
  ],
  [
    "cashuOperation",
    new Set([
      "kind",
      "status",
      "mint",
      "unit",
      "keysetId",
      "amount",
      "feeReserve",
      "inputsTotal",
      "sourceMint",
      "counter",
      "locked",
      "expiresAtSec",
    ]),
  ],
  [
    "transaction",
    new Set([
      "direction",
      "status",
      "amount",
      "fee",
      "category",
      "method",
      "phase",
      "iconKind",
      "contactId",
      "mint",
      "unit",
    ]),
  ],
  ["ownerMeta", new Set(["scope"])],
]);

export const formatEvoluDebugValue = (
  table: string,
  column: string,
  value: unknown,
): string => {
  if (!commonColumns.has(column) && !tableColumns.get(table)?.has(column)) {
    return "[redacted]";
  }
  return typeof value === "object" && value !== null
    ? JSON.stringify(value)
    : String(value ?? "");
};
