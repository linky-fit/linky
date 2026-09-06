import { createHash } from "node:crypto";

// Log-safe fingerprint for push endpoints and device tokens.
export function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
