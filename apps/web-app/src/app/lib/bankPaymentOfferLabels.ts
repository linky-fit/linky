import type {
  BankOfferStatus,
  BankPaymentOfferInfo,
} from "@linky-fit/proxy-payment";
import type { Tone } from "@linky-fit/ui";
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

export const bankPaymentOfferStatusTones: Record<BankOfferStatus, Tone> = {
  accepted: "accent",
  accepted_by_other: "neutral",
  bank_details_sent: "info",
  bank_paid: "accent",
  canceled: "neutral",
  declined: "neutral",
  offered: "warning",
  settled: "accent",
};

/**
 * A thread this peer did not end up paying is shown only as taken by someone
 * else or canceled, without its amount; the offerer settles the whole group,
 * so a settled thread without a bank payment is a losing one.
 */
export const getUnmatchedBankPaymentOfferStatus = (
  info: Pick<BankPaymentOfferInfo, "bankPaidAtSec" | "status">,
): "accepted_by_other" | "canceled" | null => {
  if (info.status === "accepted_by_other") return "accepted_by_other";
  if (info.bankPaidAtSec !== null) return null;
  if (info.status === "canceled") return "canceled";
  if (info.status === "settled") return "accepted_by_other";
  return null;
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
