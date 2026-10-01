import { Predicate, Struct } from "effect";

const isAttachment = (value: Record<string, unknown>): boolean =>
  typeof value["encryptionAlgorithm"] === "string" &&
  typeof value["key"] === "string" &&
  typeof value["nonce"] === "string";

// A cashu token is a bearer instrument: its proofs carry the mint secrets that
// let anyone holding the text spend the funds. It must never sit in a log, so a
// `token` field holding an encoded token (`cashuA`/`cashuB`) is dropped like an
// attachment key.
const isCashuTokenField = (field: string, value: unknown): boolean =>
  field === "token" && typeof value === "string" && value.startsWith("cashu");

// App message content is the app's own payload and may carry a token or keys.
const isAppMessage = (value: Record<string, unknown>): boolean =>
  typeof value["app"] === "string" && typeof value["content"] === "string";

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
  return value;
};
