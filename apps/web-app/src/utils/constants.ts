export const UNIT_TOGGLE_STORAGE_KEY = "linky_use_btc_symbol";
export const DISPLAY_CURRENCY_STORAGE_KEY = "linky.display_currency.v1";
export const DISPLAY_ALLOWED_CURRENCIES_STORAGE_KEY =
  "linky.display_allowed_currencies.v1";
export const DECIMAL_AMOUNT_INPUT_STORAGE_KEY = "linky.decimal_amount_input.v1";
// Epoch seconds when "send read receipts" was enabled; absent = off.
export const SEEN_RECEIPTS_ENABLED_AT_SEC_STORAGE_KEY =
  "linky.seen_receipts_enabled_at_sec.v1";
export {
  FIAT_RATES_CACHE_STORAGE_KEY,
  FIAT_RATES_TTL_MS,
} from "@linky/linkshu";
export const NOSTR_NSEC_STORAGE_KEY = "linky.nostr_nsec";
export const NOSTR_SLIP39_SEED_STORAGE_KEY = "linky.nostr_slip39_seed";
export const CASHU_BIP85_MNEMONIC_STORAGE_KEY = "linky.cashu_bip85_mnemonic";
export const NOSTR_IDENTITY_SOURCE_STORAGE_KEY =
  "linky.nostr_identity_source.v1";
export const NOSTR_IDENTITY_SWITCHED_AT_SEC_STORAGE_KEY =
  "linky.nostr_identity_switched_at_sec.v1";
export const EVOLU_CONTACTS_OWNER_INDEX_STORAGE_KEY =
  "linky.evolu.contacts_owner_index.v1";
export const EVOLU_CASHU_OWNER_INDEX_STORAGE_KEY =
  "linky.evolu.cashu_owner_index.v1";
export const EVOLU_MESSAGES_OWNER_INDEX_STORAGE_KEY =
  "linky.evolu.messages_owner_index.v1";
export const EVOLU_TRANSACTIONS_OWNER_INDEX_STORAGE_KEY =
  "linky.evolu.transactions_owner_index.v1";
export const EVOLU_CONTACTS_OWNER_BASELINE_COUNT_STORAGE_KEY =
  "linky.evolu.contacts_owner_baseline_count.v1";
export const EVOLU_CASHU_OWNER_BASELINE_COUNT_STORAGE_KEY =
  "linky.evolu.cashu_owner_baseline_count.v1";
export const EVOLU_MESSAGES_OWNER_BASELINE_COUNT_STORAGE_KEY =
  "linky.evolu.messages_owner_baseline_count.v1";
export const EVOLU_TRANSACTIONS_OWNER_BASELINE_COUNT_STORAGE_KEY =
  "linky.evolu.transactions_owner_baseline_count.v1";
export const EVOLU_CONTACTS_OWNER_LAST_ROTATED_AT_MS_STORAGE_KEY =
  "linky.evolu.contacts_owner_last_rotated_at_ms.v1";
export const EVOLU_CASHU_OWNER_LAST_ROTATED_AT_MS_STORAGE_KEY =
  "linky.evolu.cashu_owner_last_rotated_at_ms.v1";
export const EVOLU_MESSAGES_OWNER_LAST_ROTATED_AT_MS_STORAGE_KEY =
  "linky.evolu.messages_owner_last_rotated_at_ms.v1";
export const EVOLU_TRANSACTIONS_OWNER_LAST_ROTATED_AT_MS_STORAGE_KEY =
  "linky.evolu.transactions_owner_last_rotated_at_ms.v1";
export const CONTACTS_OWNER_ROTATION_TRIGGER_WRITE_COUNT = 220;
export const CASHU_OWNER_ROTATION_TRIGGER_WRITE_COUNT = 170;
export const MESSAGES_OWNER_ROTATION_TRIGGER_WRITE_COUNT = 160;
export const TRANSACTIONS_OWNER_ROTATION_TRIGGER_WRITE_COUNT = 220;
export const OWNER_ROTATION_COOLDOWN_MS = 60_000;
export const MAX_CONTACTS_PER_OWNER = 100;
export const INSTALL_PWA_DISMISSED_AT_MS_STORAGE_KEY =
  "linky.install_pwa_dismissed_at_ms.v1";
export const INSTALL_PWA_DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
export const INSTALL_PWA_FIRST_SHOW_DELAY_MS = 3_000;

export const CONTACTS_ONBOARDING_DISMISSED_STORAGE_KEY =
  "linky.contacts_onboarding_dismissed";
export const CONTACTS_ONBOARDING_HAS_PAID_STORAGE_KEY =
  "linky.contacts_onboarding_has_paid";
export const CONTACTS_ONBOARDING_HAS_BACKUPED_KEYS_STORAGE_KEY =
  "linky.contacts_onboarding_has_backuped_keys";
export const CASHU_ONBOARDING_SET_MAIN_MINT_STORAGE_KEY =
  "linky.cashu_onboarding_set_main_mint.v1";
export const PAY_WITH_CASHU_STORAGE_KEY = "linky.pay_with_cashu";
export const SHOW_PROFILE_QR_ON_TILT_STORAGE_KEY =
  "linky.show_profile_qr_on_tilt.v1";
export const LIGHTNING_INVOICE_AUTO_PAY_LIMIT_STORAGE_KEY =
  "linky.lightning_invoice_auto_pay_limit";
export const BANK_PAYMENT_OFFER_RECIPIENT_COUNT_STORAGE_KEY =
  "linky.bank_payment_offer_recipient_count.v1";
export const BANK_PAYMENT_OFFER_STAGGER_DELAY_SEC_STORAGE_KEY =
  "linky.bank_payment_offer_stagger_delay_sec.v1";
export const FEEDBACK_CONTACT_NPUB =
  "npub1kkht6jvgr8mt4844saf80j5jjwyy6fdy90sxsuxt4hfv8pel499s96jvz8";
export { PAYMENT_ANALYTICS_RECIPIENT_NPUB } from "@linky/linkstr";
export const NO_GROUP_FILTER = "__linky_no_group__";
export const ARCHIVED_CONTACTS_FILTER = "__linky_archived_contacts__";

export const PENDING_DEEP_LINK_TEXT_STORAGE_KEY =
  "linky.pendingDeepLinkText.v1";

export const WALLET_WARNING_BALANCE_THRESHOLD_SAT = 500_000;
export const WALLET_WARNING_DISMISSED_STORAGE_KEY =
  "linky.wallet_hardware_support_banner_dismissed.v1";
export const LIGHTNING_INVOICE_AUTO_PAY_LIMIT_SAT = 10_000;

export const LOCAL_PAYMENT_EVENTS_STORAGE_KEY_PREFIX =
  "linky.local.paymentEvents.v1";
export const LOCAL_NOSTR_MESSAGES_STORAGE_KEY_PREFIX =
  "linky.local.nostrMessages.v1";
export const LOCAL_MINT_INFO_STORAGE_KEY_PREFIX = "linky.local.mintInfo.v1";
export const LOCAL_PENDING_PAYMENTS_STORAGE_KEY_PREFIX =
  "linky.local.pendingPayments.v1";
export const LOCAL_PENDING_PAYMENT_TELEMETRY_STORAGE_KEY_PREFIX =
  "linky.local.pendingPaymentTelemetry.v1";
export const LOCAL_PENDING_PAYMENT_TELEMETRY_LOCK_STORAGE_KEY_PREFIX =
  "linky.local.pendingPaymentTelemetryLock.v1";
export const LOCAL_NPUB_CASH_CLAIM_LOCK_STORAGE_KEY_PREFIX =
  "linky.local.npubCashClaimLock.v1";
export const LOCAL_NPUB_CASH_CLAIM_LAST_ATTEMPT_STORAGE_KEY_PREFIX =
  "linky.local.npubCashClaimLastAttempt.v1";
export const LOCAL_NPUB_CASH_UPSTREAM_QUOTES_STORAGE_KEY_PREFIX =
  "linky.local.npubCashUpstreamQuotes.v1";

export const BLOCKED_NOSTR_PUBKEYS_STORAGE_KEY =
  "linky.blocked_nostr_pubkeys.v1";
export const UNKNOWN_CONTACT_ID_PREFIX = "unknown:";
