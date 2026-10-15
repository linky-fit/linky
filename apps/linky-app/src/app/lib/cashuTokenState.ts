import { isStoredCashuErrorTokenSpent } from "./cashuStoredError";
import { getUnknownErrorMessage } from "../../utils/unknown";

export const CASHU_TOKEN_STATE_ACCEPTED = "accepted";
export const CASHU_TOKEN_STATE_ERROR = "error";
const CASHU_TOKEN_STATE_EXTERNALIZED = "externalized";
const CASHU_TOKEN_STATE_ISSUED = "issued";
const CASHU_TOKEN_STATE_PENDING = "pending";
const CASHU_TOKEN_STATE_RESERVED = "reserved";

type CashuTokenState =
  | typeof CASHU_TOKEN_STATE_ACCEPTED
  | typeof CASHU_TOKEN_STATE_ERROR
  | typeof CASHU_TOKEN_STATE_EXTERNALIZED
  | typeof CASHU_TOKEN_STATE_ISSUED
  | typeof CASHU_TOKEN_STATE_PENDING
  | typeof CASHU_TOKEN_STATE_RESERVED;

export const normalizeCashuTokenState = (
  value: unknown,
): CashuTokenState | null => {
  const normalized = String(value ?? "").trim();

  if (
    normalized === CASHU_TOKEN_STATE_ACCEPTED ||
    normalized === CASHU_TOKEN_STATE_ERROR ||
    normalized === CASHU_TOKEN_STATE_EXTERNALIZED ||
    normalized === CASHU_TOKEN_STATE_ISSUED ||
    normalized === CASHU_TOKEN_STATE_PENDING ||
    normalized === CASHU_TOKEN_STATE_RESERVED
  ) {
    return normalized;
  }

  return null;
};

export const isCashuTokenAcceptedState = (value: unknown): boolean =>
  normalizeCashuTokenState(value) === CASHU_TOKEN_STATE_ACCEPTED;

export const isCashuTokenExternalizedState = (value: unknown): boolean =>
  normalizeCashuTokenState(value) === CASHU_TOKEN_STATE_EXTERNALIZED;

export const isCashuTokenIssuedState = (value: unknown): boolean =>
  normalizeCashuTokenState(value) === CASHU_TOKEN_STATE_ISSUED;

export const isCashuTokenReservedState = (value: unknown): boolean =>
  normalizeCashuTokenState(value) === CASHU_TOKEN_STATE_RESERVED;

export const isCashuTokenEmittedState = (value: unknown): boolean => {
  const state = normalizeCashuTokenState(value);
  return (
    state === CASHU_TOKEN_STATE_EXTERNALIZED ||
    state === CASHU_TOKEN_STATE_ISSUED ||
    state === CASHU_TOKEN_STATE_PENDING
  );
};

export const isCashuTokenUnavailableState = (value: unknown): boolean =>
  isCashuTokenEmittedState(value) || isCashuTokenReservedState(value);

export const isCashuTokenErrorState = (value: unknown): boolean =>
  normalizeCashuTokenState(value) === CASHU_TOKEN_STATE_ERROR;

const SPENT_OR_INVALID_ERROR_PATTERNS: readonly string[] = [
  "token already spent",
  "proofs already spent",
  "invalid proof",
  "invalid proofs",
  "token proofs missing",
  "invalid token",
];

const DEFINITIVE_INVALID_CODES = new Set<number>([
  11001, // TokenAlreadySpentError
]);

const isDefinitiveCashuError = (error: unknown): boolean => {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = Reflect.get(error, "code");
    if (typeof code === "number" && DEFINITIVE_INVALID_CODES.has(code)) {
      return true;
    }
  }

  const message = getUnknownErrorMessage(error, "").trim().toLowerCase();
  return SPENT_OR_INVALID_ERROR_PATTERNS.some((pattern) =>
    message.includes(pattern),
  );
};

export const isCashuTokenDefinitivelySpent = (token: {
  state?: unknown;
  error?: unknown;
}): boolean => {
  if (!isCashuTokenErrorState(token.state)) return false;
  return (
    isStoredCashuErrorTokenSpent(token.error) ||
    isDefinitiveCashuError(token.error)
  );
};
