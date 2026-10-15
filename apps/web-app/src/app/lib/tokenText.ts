import {
  extractTokenText,
  parseTokenText,
  tokenProofSecrets,
} from "@linky-fit/linkshu";
import {
  decodeBankPaymentOffer,
  isBankPaymentPayload,
} from "@linky-fit/proxy-payment";
import { boundedMemo } from "../../utils/boundedMemo";

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

/** Names a token by its proofs, so the same proofs match as v3, v4 or a NUT-18 payload. */
export const tokenProofsKey = boundedMemo((text: string): string | null => {
  const secrets = tokenProofSecrets(text);
  return secrets === null ? null : [...secrets].sort().join(" ");
}, 5_000);
