import type { BankOfferStatus } from "@linky/proxy-payment";
import type { Translate } from "../../i18n";

export const formatRemainingTime = (
  remainingSec: number,
  t: Translate,
): string => {
  if (remainingSec <= 0) return t("bankPaymentOfferExpired");

  const minutes = Math.floor(remainingSec / 60);
  const seconds = Math.max(0, remainingSec % 60);
  return t("bankPaymentOfferTimeRemainingClock")
    .replace("{minutes}", String(minutes))
    .replace("{seconds}", String(seconds).padStart(2, "0"));
};

export const getBankPaymentOfferStatusLabel = (
  status: BankOfferStatus,
  isIncoming: boolean,
  t: Translate,
): string => {
  switch (status) {
    case "accepted":
      return t("bankPaymentOfferStatusAccepted");
    case "accepted_by_other":
      return t("bankPaymentOfferStatusAcceptedByOther");
    case "bank_details_sent":
      return isIncoming
        ? t("bankPaymentOfferStatusBankDetailsReceived")
        : t("bankPaymentOfferStatusBankDetailsSent");
    case "bank_paid":
      return t("bankPaymentOfferStatusBankPaid");
    case "canceled":
      return t("bankPaymentOfferStatusCanceled");
    case "declined":
      return t("bankPaymentOfferStatusDeclined");
    case "settled":
      return t("bankPaymentOfferStatusSettled");
    case "offered":
      return t("bankPaymentOfferStatusOffered");
  }
};
