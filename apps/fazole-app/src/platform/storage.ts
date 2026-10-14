import type { KeyValueStorage } from "@linky-fit/linksync/evolu";

/** Device-local `localStorage`; a failing read returns `null` and a failing write is dropped. */
export const localStorageKv: KeyValueStorage = {
  getItem: (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage full or disabled: the value is simply not kept.
    }
  },
  removeItem: (key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      // Storage disabled: nothing was kept to remove.
    }
  },
};
