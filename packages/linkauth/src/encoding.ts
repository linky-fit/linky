const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export const toBase64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

export const fromBase64Url = (text: string): Uint8Array | null => {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
};

export const encodeJsonBase64Url = (value: unknown): string =>
  toBase64Url(encoder.encode(JSON.stringify(value)));

export const decodeJsonBase64Url = (text: string): unknown => {
  const bytes = fromBase64Url(text);
  if (bytes === null) return null;
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch {
    return null;
  }
};

/** Compares in time that depends on the longer input only. */
export const timingSafeEqual = (a: string, b: string): boolean => {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return diff === 0;
};
