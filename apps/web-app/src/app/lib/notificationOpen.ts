import { readField } from "../../utils/unknown";
export const unwrapNotificationOpenValue = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const isJsonObject = normalized.startsWith("{") && normalized.endsWith("}");
  const isJsonArray = normalized.startsWith("[") && normalized.endsWith("]");
  if (!isJsonObject && !isJsonArray) {
    return normalized;
  }

  try {
    return JSON.parse(normalized);
  } catch {
    return normalized;
  }
};

export const readNotificationOpenData = (value: unknown): unknown => {
  const source = unwrapNotificationOpenValue(value);
  const notification = unwrapNotificationOpenValue(
    readField(source, "notification"),
  );
  return unwrapNotificationOpenValue(
    readField(notification, "data") ?? readField(source, "data") ?? source,
  );
};
