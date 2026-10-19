import { Option, Schema } from "effect";
import {
  BANK_PAYMENT_OFFER_RECIPIENT_COUNT_STORAGE_KEY,
  BANK_PAYMENT_OFFER_STAGGER_DELAY_SEC_STORAGE_KEY,
  CASHU_ONBOARDING_SET_MAIN_MINT_STORAGE_KEY,
  CONTACTS_ONBOARDING_DISMISSED_STORAGE_KEY,
  CONTACTS_ONBOARDING_HAS_BACKUPED_KEYS_STORAGE_KEY,
  CONTACTS_ONBOARDING_HAS_PAID_STORAGE_KEY,
  DECIMAL_AMOUNT_INPUT_STORAGE_KEY,
  DISPLAY_ALLOWED_CURRENCIES_STORAGE_KEY,
  DISPLAY_CURRENCY_STORAGE_KEY,
  LIGHTNING_INVOICE_AUTO_PAY_LIMIT_STORAGE_KEY,
  LOCAL_NPUB_CASH_CLAIM_INBOX_STORAGE_KEY_PREFIX,
  NOSTR_IDENTITY_SOURCE_STORAGE_KEY,
  NOSTR_IDENTITY_SWITCHED_AT_SEC_STORAGE_KEY,
  PAY_WITH_CASHU_STORAGE_KEY,
  RECEIVE_METHOD_STORAGE_KEY,
  SEEN_RECEIPTS_ENABLED_AT_SEC_STORAGE_KEY,
  SHOW_PROFILE_QR_ON_TILT_STORAGE_KEY,
  UNIT_TOGGLE_STORAGE_KEY,
  WALLET_WARNING_DISMISSED_STORAGE_KEY,
} from "../utils/constants";
import { parseDisplayCurrency } from "../utils/displayAmounts";
import { isLang } from "../utils/lang";
import { CachedRelayListsSchema } from "../utils/nostrRelays";
import { parseReceiveMethod } from "../utils/receiveMethod";
import type { KeyValuePort } from "./ports";

type IsValid = (value: string) => boolean;

const oneOf =
  (...allowed: ReadonlyArray<string>): IsValid =>
  (value) =>
    allowed.includes(value);

const json =
  <A, I>(schema: Schema.Codec<A, I>): IsValid =>
  (value) =>
    Option.isSome(
      Schema.decodeUnknownOption(Schema.fromJsonString(schema))(value),
    );

const integerFrom =
  (min: number): IsValid =>
  (value) =>
    /^\d+$/.test(value) && Number(value) >= min;

const flag = oneOf("0", "1");
const stringList = json(Schema.Array(Schema.String));
const jsonObject = json(Schema.Record(Schema.String, Schema.Unknown));

/** Device settings and the send queue, checked the way their readers in the app read them. */
const SETTINGS: Readonly<Record<string, IsValid>> = {
  "linky.lang": (value) => isLang(value),
  "linky.color_mode": oneOf("auto", "light", "dark"),
  [DISPLAY_CURRENCY_STORAGE_KEY]: (value) =>
    parseDisplayCurrency(value) !== null,
  [DISPLAY_ALLOWED_CURRENCIES_STORAGE_KEY]: stringList,
  [UNIT_TOGGLE_STORAGE_KEY]: flag,
  [DECIMAL_AMOUNT_INPUT_STORAGE_KEY]: flag,
  [PAY_WITH_CASHU_STORAGE_KEY]: flag,
  [RECEIVE_METHOD_STORAGE_KEY]: (value) => parseReceiveMethod(value) !== null,
  [SHOW_PROFILE_QR_ON_TILT_STORAGE_KEY]: flag,
  [SEEN_RECEIPTS_ENABLED_AT_SEC_STORAGE_KEY]: integerFrom(0),
  [LIGHTNING_INVOICE_AUTO_PAY_LIMIT_STORAGE_KEY]: integerFrom(0),
  [BANK_PAYMENT_OFFER_RECIPIENT_COUNT_STORAGE_KEY]: integerFrom(1),
  [BANK_PAYMENT_OFFER_STAGGER_DELAY_SEC_STORAGE_KEY]: integerFrom(0),
  [CONTACTS_ONBOARDING_DISMISSED_STORAGE_KEY]: flag,
  [CONTACTS_ONBOARDING_HAS_PAID_STORAGE_KEY]: flag,
  [CONTACTS_ONBOARDING_HAS_BACKUPED_KEYS_STORAGE_KEY]: flag,
  [CASHU_ONBOARDING_SET_MAIN_MINT_STORAGE_KEY]: flag,
  [WALLET_WARNING_DISMISSED_STORAGE_KEY]: flag,
  "linky.inspector_enabled": oneOf("true", "false"),
  "linky.inspector_logs_enabled": oneOf("true", "false"),
  [NOSTR_IDENTITY_SOURCE_STORAGE_KEY]: oneOf("custom", "derived"),
  [NOSTR_IDENTITY_SWITCHED_AT_SEC_STORAGE_KEY]: integerFrom(1),
  // linksync's Evolu relay list, the pre-recommendation keys included for its own migration.
  "linky.evoluServers.user.v1": stringList,
  "linky.evoluServers.disabled.v1": stringList,
  "linky.evoluServers.v1": stringList,
  "linky.evoluServers.defaultRemoved.v1": json(Schema.Boolean),
  // linkstr's durable send queue; a retry republishes the same rumor id, so a delivered message never doubles.
  "linky.outbox": json(Schema.Array(Schema.Unknown)),
};

/**
 * Prefixed keys: the Nostr relay cache per pubkey, and the cashu state that
 * keeps funds reachable. Counters and restore cursors stop the wallet from
 * reusing outputs; pending top-ups and autoswap claims hold the only handle
 * on a paid quote; the npub.cash inbox holds claimed tokens not yet received.
 * The legacy cashu keys are the ones the app's linkshu storage migration
 * still converts. linkshu decodes its records on read and drops bad ones.
 */
const PREFIXED: ReadonlyArray<readonly [string, IsValid]> = [
  ["linky.nostr_relays.v1.", json(CachedRelayListsSchema)],
  ["linky.linkshu.value.linkshu.detCounter.", integerFrom(0)],
  ["linky.linkshu.value.linkshu.restoreCursor.", integerFrom(0)],
  ["linky.linkshu.value.linkshu.seenKeysets.", (value) => value !== ""],
  ["linky.linkshu.value.linkshu.pendingTopup.", jsonObject],
  ["linky.linkshu.value.linkshu.pendingAutoswapClaim.", jsonObject],
  ["linky.cashu.detCounter.v1:", integerFrom(0)],
  ["linky.cashu.restoreCursor.v1:", integerFrom(0)],
  ["linky.local.pendingTopupQuote.v1", jsonObject],
  ["linky.local.pendingAutoswapClaim.v1", jsonObject],
  [
    `${LOCAL_NPUB_CASH_CLAIM_INBOX_STORAGE_KEY_PREFIX}.`,
    (value) => /^cashu[AB]/.test(value),
  ],
];

const validatorFor = (key: string): IsValid | null =>
  SETTINGS[key] ??
  PREFIXED.find(([prefix]) => key.startsWith(prefix))?.[1] ??
  null;

const LocalStorageDump = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.String),
);

/** The Capacitor WebView's localStorage as the native module dumped it; null when it isn't a string map. */
export const parseLegacyWebStorage = (
  dump: string,
): Readonly<Record<string, string>> | null =>
  Option.getOrNull(Schema.decodeUnknownOption(LocalStorageDump)(dump));

export interface CarriedSettings {
  readonly copied: number;
  /** The native side already held a value, which wins. */
  readonly kept: number;
  readonly invalid: number;
}

/**
 * Copies the whitelisted, non-secret keys of the Capacitor WebView's
 * localStorage into the native key-value store, only into keys it doesn't
 * hold and only values their reader accepts.
 */
export const carryLegacySettings = (
  storage: Readonly<Record<string, string>>,
  kv: KeyValuePort,
): CarriedSettings => {
  let copied = 0;
  let kept = 0;
  let invalid = 0;
  for (const [key, value] of Object.entries(storage)) {
    const isValid = validatorFor(key);
    if (isValid === null) continue;
    if (!isValid(value)) invalid += 1;
    else if (kv.getItem(key) !== null) kept += 1;
    else {
      kv.setItem(key, value);
      copied += 1;
    }
  }
  return { copied, kept, invalid };
};
