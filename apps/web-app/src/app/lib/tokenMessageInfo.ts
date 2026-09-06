import { parseTokenText } from "@linky/linkshu";
import type { CashuTokenRow } from "../../evolu";
import { getLinkyBankPaymentOfferInfo } from "./bankPaymentOffer";
import { createCashuTokenId } from "./cashuTokenIdentity";
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

const isKnownCashuToken = (
  cashuTokensAll: readonly Pick<CashuTokenRow, "id" | "rawToken" | "token">[],
  tokenRaw: string,
): boolean => {
  const tokenId = createCashuTokenId(tokenRaw);
  return cashuTokensAll.some((row) => {
    const storedRaw = (row.rawToken ?? "").trim();
    const storedToken = (row.token ?? "").trim();
    return (
      row.id === tokenId ||
      (storedRaw !== "" && storedRaw === tokenRaw) ||
      (storedToken !== "" && storedToken === tokenRaw)
    );
  });
};

export const getCashuTokenMessageInfo = (
  text: string,
  cashuTokensAll: readonly Pick<CashuTokenRow, "id" | "rawToken" | "token">[],
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
    // Best-effort: "valid" means not yet imported into wallet.
    isValid: !isKnownCashuToken(cashuTokensAll, tokenRaw),
  };
};
