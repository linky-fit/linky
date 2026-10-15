const stripUrlPayload = (value: string): string => {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "[redacted URL]";
  }
};

export const redactDiagnosticText = (value: string): string =>
  value
    .replace(/https?:\/\/[^\s)]+/gi, stripUrlPayload)
    .replace(/(?:%[0-9a-f]{2})+/gi, (encoded) => {
      try {
        return decodeURIComponent(encoded);
      } catch {
        return "[redacted encoded value]";
      }
    })
    // Seed input can be incomplete or have a bad checksum. Redact long word
    // sequences without requiring a valid mnemonic or loading a wordlist.
    .replace(
      /\b(?:[a-z]+(?:[\s,;+"']|\\[nrt"])+){11,}[a-z]+\b/gi,
      "[redacted recovery phrase]",
    )
    .replace(
      /\b(?:nsec|ncryptsec)1[023456789acdefghjklmnpqrstuvwxyz]+\b/gi,
      "[redacted secret key]",
    )
    .replace(/\bcashu[ab][a-z0-9_-]{20,}\b/gi, "[redacted cashu token]")
    .replace(/\b[0-9a-f]{64}\b/gi, "[redacted 32-byte value]");

export const stringifyDiagnosticValue = (value: unknown): string =>
  JSON.stringify(
    value,
    (_key, item: unknown) => {
      if (typeof item === "string") return redactDiagnosticText(item);
      if (
        Array.isArray(item) &&
        item.length >= 12 &&
        item.every(
          (word: unknown) =>
            typeof word === "string" && /^[a-z]+$/i.test(word.trim()),
        )
      ) {
        return "[redacted recovery phrase]";
      }
      if (item !== null && typeof item === "object" && !Array.isArray(item)) {
        const entries = Object.entries(item);
        if (entries.some(([key]) => redactDiagnosticText(key) !== key)) {
          return Object.fromEntries(
            entries.map(([key, field]) => [redactDiagnosticText(key), field]),
          );
        }
      }
      return item;
    },
    2,
  ) ?? "null";
