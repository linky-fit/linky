export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const readField = (value: unknown, field: string): unknown =>
  isRecord(value) ? value[field] : undefined;

export const getUnknownErrorMessage = (
  value: unknown,
  fallback: string,
): string => {
  if (value === null || value === undefined) return fallback;

  if (typeof value === "string") {
    return value || fallback;
  }

  if (value instanceof Error) {
    return value.message || fallback;
  }

  if (isRecord(value) && typeof value.message === "string") {
    return value.message || fallback;
  }

  if (typeof value === "object") {
    try {
      const json = JSON.stringify(value);
      if (json && json !== "{}") return json;
    } catch {
      // Fall back to String below for circular/non-serializable values.
    }
  }

  const message = String(value);
  return message || fallback;
};
