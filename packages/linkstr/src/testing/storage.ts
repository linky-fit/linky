import type { StringStorage } from "../internal/stringStorage";

export interface StubStorage extends StringStorage {
  readonly map: Map<string, string>;
}

export const stubStorage = (): StubStorage => {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
};
