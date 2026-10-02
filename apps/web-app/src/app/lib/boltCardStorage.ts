import {
  createBoltCard,
  parseBoltCard,
  serializeBoltCard,
  type BoltCard,
} from "@linky-fit/bolt-card";
import {
  readAndroidStoredSecret,
  removeAndroidStoredSecret,
  writeAndroidStoredSecret,
} from "../../platform/nativeBridge";
import {
  safeLocalStorageGet,
  safeLocalStorageRemove,
  safeLocalStorageSet,
} from "../../utils/storage";

// The card keys stay in the encrypted native store; the card is device-local,
// so nothing about it reaches Evolu.
const BOLT_CARD_STORAGE_KEY = "linky.bolt_card.v1";
const BOLT_CARD_BRIDGE_URL_STORAGE_KEY = "linky.bolt_card_bridge_url.v1";

export const DEFAULT_BOLT_CARD_BRIDGE_URL =
  import.meta.env.VITE_BOLT_CARD_BRIDGE_URL || "https://bolt-card.linky.fit";

/** An http(s) origin with optional base path and no trailing slash, or null. */
export const normalizeBoltCardBridgeUrl = (value: string): string | null => {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
};

export const getBoltCardBridgeUrl = (): string =>
  normalizeBoltCardBridgeUrl(
    safeLocalStorageGet(BOLT_CARD_BRIDGE_URL_STORAGE_KEY) ?? "",
  ) ?? DEFAULT_BOLT_CARD_BRIDGE_URL;

/** Stores a user-chosen bridge; the default one is not stored, so it can move. */
export const setBoltCardBridgeUrl = (value: string): boolean => {
  const normalized = normalizeBoltCardBridgeUrl(value);
  if (normalized === null) return false;
  if (normalized === normalizeBoltCardBridgeUrl(DEFAULT_BOLT_CARD_BRIDGE_URL)) {
    safeLocalStorageRemove(BOLT_CARD_BRIDGE_URL_STORAGE_KEY);
  } else {
    safeLocalStorageSet(BOLT_CARD_BRIDGE_URL_STORAGE_KEY, normalized);
  }
  return true;
};

/** The WebSocket the card holds open on its bridge during a session. */
export const boltCardBridgeSocketUrl = (bridgeUrl: string): string =>
  `${bridgeUrl.replace(/^http/, "ws")}/session`;

// The first native read unlocks the Keystore key, which takes long enough to
// be felt; the last read or written card is kept so a session starts at once.
let cachedCard: Promise<BoltCard | null> | null = null;

const readStoredCard = async (): Promise<BoltCard | null> => {
  const stored = await readAndroidStoredSecret(BOLT_CARD_STORAGE_KEY);
  return stored ? parseBoltCard(stored) : null;
};

export const loadBoltCard = (): Promise<BoltCard | null> => {
  cachedCard ??= readStoredCard().catch(() => {
    cachedCard = null;
    return null;
  });
  return cachedCard;
};

export const saveBoltCard = async (card: BoltCard): Promise<boolean> => {
  const saved = await writeAndroidStoredSecret(
    BOLT_CARD_STORAGE_KEY,
    serializeBoltCard(card),
  );
  if (saved) cachedCard = Promise.resolve(card);
  return saved;
};

/** Null when the device has no native secret store to keep a card in. */
export const loadOrCreateBoltCard = async (): Promise<BoltCard | null> => {
  const existing = await loadBoltCard();
  if (existing) return existing;
  const card = createBoltCard();
  return (await saveBoltCard(card)) ? card : null;
};

/** The next session creates a new card with new keys and a new id. */
export const removeBoltCard = (): Promise<boolean> => {
  cachedCard = null;
  return removeAndroidStoredSecret(BOLT_CARD_STORAGE_KEY);
};
