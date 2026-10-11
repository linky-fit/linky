import React from "react";
import {
  BANK_PAYMENT_OFFER_RECIPIENT_COUNT_STORAGE_KEY,
  BANK_PAYMENT_OFFER_STAGGER_DELAY_SEC_STORAGE_KEY,
  DISPLAY_ALLOWED_CURRENCIES_STORAGE_KEY,
  LIGHTNING_INVOICE_AUTO_PAY_LIMIT_STORAGE_KEY,
  PAY_WITH_CASHU_STORAGE_KEY,
  SEEN_RECEIPTS_ENABLED_AT_SEC_STORAGE_KEY,
  SHOW_PROFILE_QR_ON_TILT_STORAGE_KEY,
} from "../../utils/constants";
import type { DisplayCurrency } from "../../utils/displayAmounts";
import { safeLocalStorageSet } from "../../utils/storage";

interface UseAppPreferencesParams {
  allowedDisplayCurrencies: readonly DisplayCurrency[];
  bankPaymentOfferRecipientCount: number;
  bankPaymentOfferStaggerDelaySec: number;
  lightningInvoiceAutoPayLimit: number;
  payWithCashuEnabled: boolean;
  seenReceiptsEnabledAtSec: number | null;
  showProfileQrOnTiltEnabled: boolean;
}

export const useAppPreferences = ({
  allowedDisplayCurrencies,
  bankPaymentOfferRecipientCount,
  bankPaymentOfferStaggerDelaySec,
  lightningInvoiceAutoPayLimit,
  payWithCashuEnabled,
  seenReceiptsEnabledAtSec,
  showProfileQrOnTiltEnabled,
}: UseAppPreferencesParams): void => {
  React.useEffect(() => {
    safeLocalStorageSet(
      DISPLAY_ALLOWED_CURRENCIES_STORAGE_KEY,
      JSON.stringify(allowedDisplayCurrencies),
    );
  }, [allowedDisplayCurrencies]);

  React.useEffect(() => {
    safeLocalStorageSet(
      PAY_WITH_CASHU_STORAGE_KEY,
      payWithCashuEnabled ? "1" : "0",
    );
  }, [payWithCashuEnabled]);

  React.useEffect(() => {
    safeLocalStorageSet(
      LIGHTNING_INVOICE_AUTO_PAY_LIMIT_STORAGE_KEY,
      String(lightningInvoiceAutoPayLimit),
    );
  }, [lightningInvoiceAutoPayLimit]);

  React.useEffect(() => {
    safeLocalStorageSet(
      BANK_PAYMENT_OFFER_RECIPIENT_COUNT_STORAGE_KEY,
      String(bankPaymentOfferRecipientCount),
    );
  }, [bankPaymentOfferRecipientCount]);

  React.useEffect(() => {
    safeLocalStorageSet(
      BANK_PAYMENT_OFFER_STAGGER_DELAY_SEC_STORAGE_KEY,
      String(bankPaymentOfferStaggerDelaySec),
    );
  }, [bankPaymentOfferStaggerDelaySec]);

  React.useEffect(() => {
    // "0" (not key removal) persists the off state: an absent key means
    // "never decided" and re-enables by default on the next launch.
    safeLocalStorageSet(
      SEEN_RECEIPTS_ENABLED_AT_SEC_STORAGE_KEY,
      seenReceiptsEnabledAtSec === null
        ? "0"
        : String(seenReceiptsEnabledAtSec),
    );
  }, [seenReceiptsEnabledAtSec]);

  React.useEffect(() => {
    safeLocalStorageSet(
      SHOW_PROFILE_QR_ON_TILT_STORAGE_KEY,
      showProfileQrOnTiltEnabled ? "1" : "0",
    );
  }, [showProfileQrOnTiltEnabled]);
};
