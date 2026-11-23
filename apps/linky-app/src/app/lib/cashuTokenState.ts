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
