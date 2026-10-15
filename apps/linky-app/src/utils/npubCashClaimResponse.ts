import type { JsonValue } from "../types/json";
import { asRecord } from "./validation";

export const extractUniqueClaimTokens = (value: JsonValue): string[] => {
  const root = asRecord(value);
  if (!root || root.error) return [];

  const data = asRecord(root.data);
  const seen = new Set<string>();
  const tokens: string[] = [];

  const addToken = (candidate: unknown) => {
    const text = String(candidate ?? "").trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    tokens.push(text);
  };

  addToken(data?.token ?? root.token);

  const dataTokens = data?.tokens;
  if (Array.isArray(dataTokens)) {
    for (const item of dataTokens) {
      addToken(item);
    }
  }

  return tokens;
};
