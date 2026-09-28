import { extractTokenText, parseTokenText } from "@linky-fit/linkshu";
import {
  decodeBankPaymentOffer,
  isBankPaymentPayload,
} from "@linky-fit/proxy-payment";

/** linkshu's `extractTokenText` behind a bank-payment-payload exclusion. */
export const extractCashuTokenFromText = (text: string): string | null => {
  const raw = text.trim();
  if (!raw) return null;
  if (isBankPaymentPayload(raw) || decodeBankPaymentOffer(raw)) {
    return null;
  }
  return extractTokenText(raw);
};

export const isStandaloneCashuTokenMessage = (text: string): boolean =>
  parseTokenText(text) !== null;
