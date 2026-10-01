import { SchemaIssue } from "effect";
import { describeTaggedCashuError } from "../app/lib/cashuStoredError";

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const readField = (value: unknown, field: string): unknown =>
  isRecord(value) ? value[field] : undefined;

const describeTagged = (value: Record<string, unknown>): string | null => {
  const tag = value["_tag"];
  if (typeof tag !== "string") return null;
  const cashuText = describeTaggedCashuError(value);
  if (cashuText !== null) return cashuText;
  const fields = JSON.stringify(value, (key: string, field: unknown) =>
    key === "_tag" ? undefined : field,
  );
  return fields === undefined || fields === "{}" ? tag : `${tag} ${fields}`;
};

const describeError = (error: Error): string => {
  const issue = SchemaIssue.isIssue(error.cause)
    ? SchemaIssue.makeFormatterDefault()(error.cause)
    : "";
  const message = error.message || (describeTagged({ ...error }) ?? "");
  return [message, issue].filter(Boolean).join(": ");
};

export const getUnknownErrorMessage = (
  value: unknown,
  fallback: string,
): string => {
  if (value === null || value === undefined) return fallback;

  if (typeof value === "string") {
    return value || fallback;
  }

  if (value instanceof Error) {
    return describeError(value) || fallback;
  }

  if (isRecord(value)) {
    const message = value["message"];
    if (typeof message === "string" && message !== "") return message;
    const tagged = describeTagged(value);
    if (tagged !== null) return tagged;
    if (typeof message === "string") return fallback;
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
