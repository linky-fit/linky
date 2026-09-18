import { parseTokenText } from "@linky/linkshu";
import { getLinkyBankPaymentOfferInfo } from "./bankPaymentOffer";
import { parsePrivateImageMessage } from "./privateImageMessage";
import { extractCashuTokenFromText } from "./tokenText";

export interface CashuTokenMessageInfo {
  amount: number | null;
  isValid: boolean;
  mintDisplay: string | null;
  mintUrl: string | null;
  tokenRaw: string;
  unit: string | null;
}

export const getMintDisplay = (
  mintValue: string | null | undefined,
): string | null => {
  const mintText = (mintValue ?? "").trim();
  if (!mintText) return null;
  try {
    return new URL(mintText).host;
  } catch {
    return mintText;
  }
};

export const getCashuTokenMessageInfo = (
  text: string,
  /** Token texts the wallet's transfers carry (sent or received). */
  knownTokenTexts: ReadonlySet<string> = new Set(),
): CashuTokenMessageInfo | null => {
  if (getLinkyBankPaymentOfferInfo(text)) return null;
  if (parsePrivateImageMessage(text)) return null;

  const tokenRaw = extractCashuTokenFromText(text);
  if (!tokenRaw) return null;

  const parsed = parseTokenText(tokenRaw);
  if (!parsed) return null;

  return {
    tokenRaw,
    mintDisplay: getMintDisplay(parsed.mint),
    mintUrl: parsed.mint,
    amount: parsed.amount,
    unit: parsed.unit,
    // Best-effort: "valid" means no transfer carries this text yet; a token
    // whose proofs the wallet holds is caught by linkshu's receive dedup.
    isValid: !knownTokenTexts.has(tokenRaw),
  };
};
