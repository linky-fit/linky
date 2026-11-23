import { Predicate, Struct } from "effect";
import { SHARED_LISTING_MARKER_PREFIX } from "../listings/sharedListing";

const isAttachment = (value: Record<string, unknown>): boolean =>
  typeof value["encryptionAlgorithm"] === "string" &&
  typeof value["key"] === "string" &&
  typeof value["nonce"] === "string";

// A cashu token (cashuA/cashuB) or NUT-18 JSON payment payload carries spendable
// proof secrets and must never sit in inspector logs.
const isNut18ProofPayload = (value: string): boolean => {
  const trimmed = value.trimStart();
  if (!trimmed.startsWith("{")) return false;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return (
      Predicate.isObject(parsed) &&
      "proofs" in parsed &&
      Array.isArray(parsed["proofs"])
    );
  } catch {
    return false;
  }
};

const isCashuTokenField = (field: string, value: unknown): boolean =>
  field === "token" &&
  typeof value === "string" &&
  (value.startsWith("cashu") || isNut18ProofPayload(value));

// App message content is the app's own payload and may carry a token or keys.
const isAppMessage = (value: Record<string, unknown>): boolean =>
  typeof value["app"] === "string" && typeof value["content"] === "string";

// A shared listing marker carries the photo's url, key and nonce.
const sharedListingMarker = new RegExp(
  `${SHARED_LISTING_MARKER_PREFIX}[\\w-]+`,
  "g",
);

const redactString = (value: string): string => {
  if (isNut18ProofPayload(value)) return "[redacted cashu token]";
  return value.replace(
    sharedListingMarker,
    `${SHARED_LISTING_MARKER_PREFIX}[redacted listing]`,
  );
};

const redactRecord = (value: Record<string, unknown>): unknown => {
  if (isAttachment(value)) return Struct.omit(value, ["key", "nonce"]);
  if (isAppMessage(value)) {
    return { ...value, content: "[redacted app message]" };
  }
  let changed = false;
  const redacted: Record<string, unknown> = {};
  for (const [field, nested] of Object.entries(value)) {
    if (isCashuTokenField(field, nested)) {
      redacted[field] = "[redacted cashu token]";
      changed = true;
      continue;
    }
    const next = redactInspectorSecrets(nested);
    if (next !== nested) changed = true;
    redacted[field] = next;
  }
  return changed ? redacted : value;
};

export const redactInspectorSecrets = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    const redacted = value.map(redactInspectorSecrets);
    return redacted.every((next, index) => next === value[index])
      ? value
      : redacted;
  }
  if (Predicate.isObject(value)) return redactRecord(value);
  if (typeof value === "string") return redactString(value);
  return value;
};
