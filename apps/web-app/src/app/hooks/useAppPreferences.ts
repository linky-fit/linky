import React from "react";
import { useAtomValue } from "@linky-fit/linkstr-react";
import {
  BANK_PAYMENT_OFFER_RECIPIENT_COUNT_STORAGE_KEY,
  BANK_PAYMENT_OFFER_STAGGER_DELAY_SEC_STORAGE_KEY,
  DISPLAY_ALLOWED_CURRENCIES_STORAGE_KEY,
} from "../../utils/constants";
import { safeLocalStorageSet } from "../../utils/storage";
import { allowedDisplayCurrenciesAtom } from "../state/shell/displayPrefs";

interface UseAppPreferencesParams {
  bankPaymentOfferRecipientCount: number;
  bankPaymentOfferStaggerDelaySec: number;
}

export const useAppPreferences = ({
  bankPaymentOfferRecipientCount,
  bankPaymentOfferStaggerDelaySec,
}: UseAppPreferencesParams): void => {
  const allowedDisplayCurrencies = useAtomValue(allowedDisplayCurrenciesAtom);
  React.useEffect(() => {
    safeLocalStorageSet(
      DISPLAY_ALLOWED_CURRENCIES_STORAGE_KEY,
      JSON.stringify(allowedDisplayCurrencies),
    );
  }, [allowedDisplayCurrencies]);

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
};
