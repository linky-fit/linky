import { MintOperationError } from "@cashu/cashu-ts";
import { errorMessage } from "./errorMessage";

/**
 * Recognizers for the mint failures the swap loop can recover from by moving
 * the deterministic counter. Message fallbacks included: not every mint sends
 * codes.
 */

const mintErrorCode = (error: unknown): number | null =>
  error instanceof MintOperationError ? error.code : null;

const lowercaseMessage = (error: unknown): string =>
  errorMessage(error, "").toLowerCase();

// NUT-00 currently assigns 11005, but nutshell and compatible mints have
// also returned 11003 for the same `outputs already signed` condition.
export const isOutputsAlreadySignedError = (error: unknown): boolean => {
  const code = mintErrorCode(error);
  if (code === 11003 || code === 11005) return true;
  const message = lowercaseMessage(error);
  return (
    message.includes("outputs have already been signed") ||
    message.includes("outputs already signed") ||
    message.includes("already been signed before") ||
    message.includes("keyset id already signed")
  );
};

// CDK also reports 11008 when unique outputs collide with stored promises.
export const isDuplicateOutputsError = (error: unknown): boolean =>
  mintErrorCode(error) === 11008 ||
  lowercaseMessage(error).includes("duplicate outputs");

// NUT-04/NUT-05 code 11004: the mint holds orphan unsigned promise rows
// (`c_ IS NULL`) matching our B_'s, typically melt-blank leftovers. Restore
// cannot surface unsigned promises, so recovery uses a fixed bump instead.
const isOutputsPendingError = (error: unknown): boolean => {
  if (mintErrorCode(error) === 11004) return true;
  const message = lowercaseMessage(error);
  return (
    message.includes("outputs are pending") ||
    message.includes("output is pending")
  );
};

export const isRecoverableOutputCollision = (error: unknown): boolean =>
  isOutputsAlreadySignedError(error) ||
  isOutputsPendingError(error) ||
  isDuplicateOutputsError(error);

/** cashu-ts's own throw when the offered proofs cannot cover amount + fees. */
export const isInsufficientBalanceError = (error: unknown): boolean =>
  lowercaseMessage(error).includes("not enough funds");

/** NUT-07 definitive rejection of spent inputs (code 11001). */
export const isTokenAlreadySpentError = (error: unknown): boolean =>
  mintErrorCode(error) === 11001 ||
  lowercaseMessage(error).includes("already spent");
