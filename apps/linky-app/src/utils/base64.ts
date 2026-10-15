import { base64urlnopad } from "@scure/base";

// Re-wrapped so a realm-foreign view (a Node Buffer under jsdom) passes
// @scure/base's instanceof check.
export const encodeBase64Url = (bytes: Uint8Array): string =>
  base64urlnopad.encode(
    new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
  );

/** Tolerates padding and the standard alphabet; null when not base64. */
export const decodeBase64Url = (value: string): Uint8Array | null => {
  const normalized = value
    .trim()
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  try {
    return base64urlnopad.decode(normalized);
  } catch {
    return null;
  }
};
