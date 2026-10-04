const codePoints = (value: string): ReadonlyArray<number> =>
  Array.from(value, (character) => character.codePointAt(0) ?? 0);

// securesystemslib sorts keys by code point, not by UTF-16 code unit.
const byCodePoint = (left: string, right: string): number => {
  const a = codePoints(left);
  const b = codePoints(right);
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
};

class NotCanonicalizable extends Error {}

const encode = (value: unknown): string => {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isSafeInteger(value)) {
        throw new NotCanonicalizable("only integers are canonical");
      }
      return String(value);
    case "string":
      return `"${value.replace(/[\\"]/g, (character) => `\\${character}`)}"`;
    case "object":
      if (Array.isArray(value)) return `[${value.map(encode).join(",")}]`;
      return `{${Object.entries(value)
        .sort(([left], [right]) => byCodePoint(left, right))
        .map(([key, entry]) => `${encode(key)}:${encode(entry)}`)
        .join(",")}}`;
    default:
      throw new NotCanonicalizable(`${typeof value} is not JSON`);
  }
};

/**
 * OLPC canonical JSON (securesystemslib) as UTF-8 bytes: sorted keys, no
 * whitespace, only `"` and `\` escaped. Null for values it cannot encode,
 * such as non-integer numbers.
 */
export const canonicalJsonBytes = (value: unknown): Uint8Array | null => {
  try {
    return new TextEncoder().encode(encode(value));
  } catch (error) {
    if (error instanceof NotCanonicalizable) return null;
    throw error;
  }
};
