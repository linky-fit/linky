import { parseTokenText } from "@linky-fit/linkshu";
import { decodeBankPaymentOffer } from "@linky-fit/proxy-payment";
import { parsePrivateImageMessage } from "./privateImageMessage";
import { extractCashuTokenFromText } from "./tokenText";
import { boundedMemo } from "../../utils/boundedMemo";
import { isHiddenTestMint } from "../../utils/mint";

export interface CashuTokenMessageInfo {
  amount: number | null;
  /** A test-mint token while test mints are off: shown, never accepted. */
  isHiddenTestMint: boolean;
  isValid: boolean;
  /** The sender's note carried in the token (NUT-00 memo). */
  memo: string | null;
  mintDisplay: string | null;
  mintUrl: string | null;
  tokenRaw: string;
  unit: string | null;
}

const getCashuTokenMemo = (memo: string | null | undefined): string | null =>
  (memo ?? "").trim() || null;

/** The note a received or sent token carries, for the transaction history. */
export const readCashuTokenMemo = (tokenText: string): string | null =>
  getCashuTokenMemo(parseTokenText(tokenText)?.memo);

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

// Every chat row and preview asks again on each render; message text never changes in place.
const tokenInMessage = boundedMemo((text: string) => {
  if (decodeBankPaymentOffer(text)) return null;
  if (parsePrivateImageMessage(text)) return null;

  const tokenRaw = extractCashuTokenFromText(text);
  if (!tokenRaw) return null;

  const parsed = parseTokenText(tokenRaw);
  return parsed && { parsed, tokenRaw };
}, 5_000);

export const getCashuTokenMessageInfo = (
  text: string,
  /** Token texts the wallet's transfers carry (sent or received). */
  knownTokenTexts: ReadonlySet<string> = new Set(),
  allowTestMints = true,
): CashuTokenMessageInfo | null => {
  const token = tokenInMessage(text);
  if (!token) return null;
  const { parsed, tokenRaw } = token;

  return {
    tokenRaw,
    memo: getCashuTokenMemo(parsed.memo),
    mintDisplay: getMintDisplay(parsed.mint),
    mintUrl: parsed.mint,
    amount: parsed.amount,
    unit: parsed.unit,
    isHiddenTestMint: isHiddenTestMint(parsed.mint, allowTestMints),
    // Best-effort: "valid" means no transfer carries this text yet; a token
    // whose proofs the wallet holds is caught by linkshu's receive dedup.
    isValid: !knownTokenTexts.has(tokenRaw),
  };
};
