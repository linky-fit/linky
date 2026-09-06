import { Option, Schema } from "effect";
import {
  getDefaultAllowedDisplayCurrencies,
  getDefaultDisplayCurrency,
} from "./browserPreferences";
import {
  BANK_PAYMENT_OFFER_RECIPIENT_COUNT_STORAGE_KEY,
  BANK_PAYMENT_OFFER_STAGGER_DELAY_SEC_STORAGE_KEY,
  DECIMAL_AMOUNT_INPUT_STORAGE_KEY,
  DISPLAY_ALLOWED_CURRENCIES_STORAGE_KEY,
  DISPLAY_CURRENCY_STORAGE_KEY,
  LIGHTNING_INVOICE_AUTO_PAY_LIMIT_SAT,
  LIGHTNING_INVOICE_AUTO_PAY_LIMIT_STORAGE_KEY,
  NOSTR_IDENTITY_SOURCE_STORAGE_KEY,
  NOSTR_IDENTITY_SWITCHED_AT_SEC_STORAGE_KEY,
  NOSTR_NSEC_STORAGE_KEY,
  PAY_WITH_CASHU_STORAGE_KEY,
  SEEN_RECEIPTS_ENABLED_AT_SEC_STORAGE_KEY,
  SHOW_PROFILE_QR_ON_TILT_STORAGE_KEY,
  UNIT_TOGGLE_STORAGE_KEY,
} from "./constants";
import {
  normalizeAllowedDisplayCurrencies,
  parseDisplayCurrency,
  type DisplayCurrency,
} from "./displayAmounts";
import { asNonEmptyString, trimString } from "./validation";

import { nowSeconds, sleep } from "./time";

export const safeLocalStorageGet = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const safeLocalStorageSet = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable or full in privacy-restricted browsers.
  }
};

export const safeLocalStorageRemove = (key: string): void => {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable in privacy-restricted browsers.
  }
};

export const safeLocalStorageKeys = (): string[] => {
  try {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key !== null) keys.push(key);
    }
    return keys;
  } catch {
    return [];
  }
};

export const safeLocalStorageGetJson = <A, I>(
  key: string,
  schema: Schema.Schema<A, I>,
  fallback: A,
): A => {
  const raw = safeLocalStorageGet(key);
  if (!raw) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }
  return Option.getOrElse(
    Schema.decodeUnknownOption(schema)(parsed),
    () => fallback,
  );
};

export const safeLocalStorageSetJson = (key: string, value: unknown): void => {
  try {
    safeLocalStorageSet(key, JSON.stringify(value));
  } catch {
    // Circular or non-serializable values are not persisted.
  }
};

const LeaseLockRecord = Schema.Struct({
  expiresAtMs: Schema.Number,
  owner: Schema.String,
});

const createLeaseLockOwner = (): string => {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (typeof randomUuid === "string" && randomUuid.trim()) return randomUuid;
  return `${Date.now()}:${Math.random().toString(36).slice(2)}`;
};

const readLocalStorageLeaseLock = (key: string) =>
  safeLocalStorageGetJson(key, Schema.NullOr(LeaseLockRecord), null);

export const withLocalStorageLeaseLock = async <T>(args: {
  key: string;
  ttlMs?: number;
  timeoutMs?: number;
  waitMs?: number;
  fn: () => Promise<T>;
}): Promise<T> => {
  const ttlMs =
    Number.isFinite(args.ttlMs) && (args.ttlMs ?? 0) > 0
      ? Math.floor(args.ttlMs ?? 0)
      : 15_000;
  const timeoutMs =
    Number.isFinite(args.timeoutMs) && (args.timeoutMs ?? 0) >= 0
      ? Math.floor(args.timeoutMs ?? 0)
      : 15_000;
  const waitMs =
    Number.isFinite(args.waitMs) && (args.waitMs ?? 0) > 0
      ? Math.floor(args.waitMs ?? 0)
      : 50;

  const owner = createLeaseLockOwner();
  const startedAt = Date.now();

  while (true) {
    const now = Date.now();
    const current = readLocalStorageLeaseLock(args.key);

    if (!current || current.expiresAtMs <= now || current.owner === owner) {
      safeLocalStorageSetJson(args.key, {
        owner,
        expiresAtMs: now + ttlMs,
      });

      const confirmed = readLocalStorageLeaseLock(args.key);
      if (confirmed?.owner === owner) break;
    }

    if (now - startedAt >= timeoutMs) {
      throw new Error(`Timed out waiting for lock: ${args.key}`);
    }

    await sleep(waitMs);
  }

  const heartbeat = globalThis.setInterval(
    () => {
      const current = readLocalStorageLeaseLock(args.key);
      if (current?.owner !== owner) return;
      safeLocalStorageSetJson(args.key, {
        owner,
        expiresAtMs: Date.now() + ttlMs,
      });
    },
    Math.max(250, Math.floor(ttlMs / 3)),
  );

  try {
    return await args.fn();
  } finally {
    globalThis.clearInterval(heartbeat);
    const current = readLocalStorageLeaseLock(args.key);
    if (current?.owner === owner) {
      safeLocalStorageRemove(args.key);
    }
  }
};

const readStoredInt = (key: string): number | null => {
  const parsed = Number.parseInt(trimString(safeLocalStorageGet(key)), 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const getLegacyDefaultDisplayCurrency = (): DisplayCurrency =>
  safeLocalStorageGet(UNIT_TOGGLE_STORAGE_KEY) === "1"
    ? "btc"
    : getDefaultDisplayCurrency();

export const getInitialDisplayCurrency = (): DisplayCurrency => {
  const allowedCurrencies = getInitialAllowedDisplayCurrencies();
  const stored = parseDisplayCurrency(
    safeLocalStorageGet(DISPLAY_CURRENCY_STORAGE_KEY),
  );
  if (stored && allowedCurrencies.includes(stored)) return stored;

  const legacyDefault = getLegacyDefaultDisplayCurrency();
  if (allowedCurrencies.includes(legacyDefault)) return legacyDefault;

  return allowedCurrencies[0] ?? legacyDefault;
};

export const getInitialAllowedDisplayCurrencies = (): DisplayCurrency[] => {
  const stored = safeLocalStorageGetJson(
    DISPLAY_ALLOWED_CURRENCIES_STORAGE_KEY,
    Schema.NullOr(Schema.Array(Schema.String)),
    null,
  );
  if (stored) {
    return normalizeAllowedDisplayCurrencies(
      stored,
      getDefaultDisplayCurrency(),
    );
  }

  const legacyDefault =
    parseDisplayCurrency(safeLocalStorageGet(DISPLAY_CURRENCY_STORAGE_KEY)) ??
    getLegacyDefaultDisplayCurrency();

  return normalizeAllowedDisplayCurrencies(
    getDefaultAllowedDisplayCurrencies().concat(legacyDefault),
    legacyDefault,
  );
};

export const getInitialDecimalAmountInputEnabled = (): boolean =>
  safeLocalStorageGet(DECIMAL_AMOUNT_INPUT_STORAGE_KEY) === "1";

// Default ON: an absent key self-initializes to "enabled now", so both fresh
// installs and updated ones start sending receipts with a baseline of first
// launch — history older than the feature is still never reported. "0" is the
// explicit off state.
export const getInitialSeenReceiptsEnabledAtSec = (): number | null => {
  const raw = trimString(
    safeLocalStorageGet(SEEN_RECEIPTS_ENABLED_AT_SEC_STORAGE_KEY),
  );
  if (raw === "0") return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : nowSeconds();
};

export const getInitialPayWithCashuEnabled = (): boolean => {
  const stored = trimString(safeLocalStorageGet(PAY_WITH_CASHU_STORAGE_KEY));
  return !stored || stored === "1";
};

export const getInitialShowProfileQrOnTiltEnabled = (): boolean =>
  safeLocalStorageGet(SHOW_PROFILE_QR_ON_TILT_STORAGE_KEY) === "1";

export const getInitialLightningInvoiceAutoPayLimit = (): number => {
  const stored = readStoredInt(LIGHTNING_INVOICE_AUTO_PAY_LIMIT_STORAGE_KEY);
  return stored !== null && stored >= 0
    ? stored
    : LIGHTNING_INVOICE_AUTO_PAY_LIMIT_SAT;
};

export const getInitialBankPaymentOfferRecipientCount = (
  fallback: number,
): number => {
  const stored = readStoredInt(BANK_PAYMENT_OFFER_RECIPIENT_COUNT_STORAGE_KEY);
  return stored !== null && stored > 0 ? stored : fallback;
};

export const getInitialBankPaymentOfferStaggerDelaySec = (
  fallback: number,
): number => {
  const stored = readStoredInt(
    BANK_PAYMENT_OFFER_STAGGER_DELAY_SEC_STORAGE_KEY,
  );
  return stored !== null && stored >= 0 ? stored : fallback;
};

export const getInitialNostrNsec = (): string | null =>
  asNonEmptyString(safeLocalStorageGet(NOSTR_NSEC_STORAGE_KEY));

export const getInitialNostrIdentitySource = (): "custom" | "derived" =>
  trimString(safeLocalStorageGet(NOSTR_IDENTITY_SOURCE_STORAGE_KEY)) ===
  "custom"
    ? "custom"
    : "derived";

export const getInitialNostrIdentitySwitchedAtSec = (): number | null => {
  const stored = readStoredInt(NOSTR_IDENTITY_SWITCHED_AT_SEC_STORAGE_KEY);
  return stored !== null && stored > 0 ? stored : null;
};
