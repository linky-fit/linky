export const DEFAULT_OWNER_QUOTA_BYTES = 100 * 1024 * 1024;

export function readOwnerQuotaBytes(env = process.env) {
  const raw = env.EVOLU_OWNER_QUOTA_BYTES;
  if (raw === undefined) return DEFAULT_OWNER_QUOTA_BYTES;
  const value = Number(raw);
  if (!/^(0|[1-9]\d*)$/.test(raw) || !Number.isSafeInteger(value)) {
    throw new Error(
      "EVOLU_OWNER_QUOTA_BYTES must be a non-negative safe integer in decimal bytes",
    );
  }
  return value;
}

const ERROR_CATEGORIES = new Map([
  ["storage", "storage error"],
  ["error", "WebSocket error"],
  ["applyProtocolMessageAsRelay", "invalid protocol message"],
  ["applyProtocolMessageAsRelayUnknownError", "protocol processing error"],
]);

export function logRelayError(_tag, category) {
  console.error(
    `[evolu-relay] ${ERROR_CATEGORIES.get(category) ?? "relay error"}`,
  );
}
