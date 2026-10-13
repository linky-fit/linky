import type { KeyValuePort } from "./ports";

/**
 * Whether this device holds an app mnemonic: non-secret evidence for boot
 * when the secure store can't answer. Null when unknown (never recorded).
 */
export type AppMnemonicState = "present" | "absent";

const APP_MNEMONIC_STATE_STORAGE_KEY = "linky.app_mnemonic_state.v1";

export const readAppMnemonicState = (
  kv: KeyValuePort,
): AppMnemonicState | null => {
  const value = kv.getItem(APP_MNEMONIC_STATE_STORAGE_KEY);
  return value === "present" || value === "absent" ? value : null;
};

export const writeAppMnemonicState = (
  kv: KeyValuePort,
  state: AppMnemonicState,
): void => kv.setItem(APP_MNEMONIC_STATE_STORAGE_KEY, state);
