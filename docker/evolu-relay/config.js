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

// The relay logs owner ids and payloads beside its messages; only these leave the process, without them.
const LOGGED_MESSAGES = new Map([
  ["invalid protocol request", "invalid protocol message"],
  ["health check failed", "storage error"],
]);

export const relayConsoleOutput = {
  write: ({ method, args }) => {
    const message = LOGGED_MESSAGES.get(args[0]);
    if (message) console.error(`[evolu-relay] ${message}`);
    else if (method === "error") console.error("[evolu-relay] relay error");
  },
};
