import { Schema } from "effect";

export const safeLocalStorageGet = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const safeLocalStorageSet = (key: string, value: string): boolean => {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
};

export const safeLocalStorageRemove = (key: string): boolean => {
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
};

export const safeLocalStorageGetJson = <A, I>(
  key: string,
  schema: Schema.Schema<A, I>,
  fallback: A,
): A => {
  const raw = safeLocalStorageGet(key);
  if (raw === null) return fallback;
  const result = Schema.decodeUnknownOption(Schema.parseJson(schema))(raw);
  return result._tag === "Some" ? result.value : fallback;
};
