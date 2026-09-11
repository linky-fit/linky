/**
 * Linkshu persists failures on token rows as serialized tagged errors
 * (`{"_tag":"TokenAlreadySpent",...}`); legacy rows carry plain text. These
 * helpers translate both shapes for display and classification without the
 * UI string-matching raw JSON.
 */

const readStringField = (error: object, key: string): string | null => {
  const value: unknown = Reflect.get(error, key);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
};

const withDetail = (base: string, detail: string | null): string =>
  detail === null ? base : `${base}: ${detail}`;

const readAmountField = (error: object, key: string): number | null => {
  const value: unknown = Reflect.get(error, key);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

/**
 * The `need X, have Y` suffix keeps the amount-degrade retry ladder
 * (`getPaymentAmountShortage`) able to size the next attempt exactly.
 */
const describeInsufficientFunds = (error: object): string => {
  const required = readAmountField(error, "required");
  const available = readAmountField(error, "available");
  return required !== null && available !== null
    ? `Insufficient funds (need ${required}, have ${available})`
    : "Insufficient funds";
};

/** Human text for a live or parsed tagged cashu error; null for unknown shapes. */
export const describeTaggedCashuError = (error: unknown): string | null => {
  if (typeof error !== "object" || error === null) return null;
  const tag = readStringField(error, "_tag");
  if (tag === null) return null;
  const detail = readStringField(error, "detail");
  switch (tag) {
    case "TokenParseFailed":
      return withDetail("Invalid token", detail);
    case "TokenAlreadySpent":
      return "Token already spent";
    case "MintUnreachable":
      return withDetail("Mint unreachable", detail);
    case "MintRejected":
      return withDetail("Mint rejected the token", detail);
    case "CounterLockTimeout":
      return "Wallet is busy in another window, try again";
    case "InsufficientFunds":
      return describeInsufficientFunds(error);
    case "PaymentFailed":
      return withDetail("Lightning payment failed", detail);
    case "PaymentPending":
      return "Lightning payment pending at the mint";
    case "QuoteExpired":
      return "The quote expired, try again";
    case "QuoteAlreadyIssued":
      return "Another wallet already minted this quote";
    case "TokenAlreadyKnown":
      return "Token is already in the wallet";
    case "OperationNotFound":
      return "Token not found";
    case "MintInUse":
      return "Mint still holds tokens";
    case "InvalidTransferTransition":
      return "Token state does not allow this";
    case "LegacyError":
      return detail;
    default:
      return null;
  }
};

const parseTaggedErrorJson = (text: string): object | null => {
  if (!text.startsWith("{")) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" &&
      parsed !== null &&
      typeof Reflect.get(parsed, "_tag") === "string"
      ? parsed
      : null;
  } catch {
    return null;
  }
};

/**
 * Display text for a stored `cashuToken.error` value: tagged JSON becomes
 * readable text, legacy plain text passes through, empty becomes null.
 */
export const formatStoredCashuError = (stored: unknown): string | null => {
  if (typeof stored !== "string") return null;
  const text = stored.trim();
  if (text === "") return null;
  const tagged = parseTaggedErrorJson(text);
  return (tagged !== null ? describeTaggedCashuError(tagged) : null) ?? text;
};

/** True when a stored error is linkshu's definitive already-spent failure. */
export const isStoredCashuErrorTokenSpent = (stored: unknown): boolean => {
  if (typeof stored !== "string") return false;
  const tagged = parseTaggedErrorJson(stored.trim());
  return tagged !== null && Reflect.get(tagged, "_tag") === "TokenAlreadySpent";
};
