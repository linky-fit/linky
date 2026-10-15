const QR_ALPHANUMERIC_RE = /^[0-9A-Z $%*+\-./:]+$/;

/**
 * Uppercase a case-insensitive payload when that lets the QR encoder use its
 * denser alphanumeric mode. The caller must only opt in for formats whose
 * values are explicitly case-insensitive, such as Bech32.
 */
export const optimizeCaseInsensitiveQrPayload = (payload: string): string => {
  const uppercasePayload = payload.toUpperCase();
  return QR_ALPHANUMERIC_RE.test(uppercasePayload) ? uppercasePayload : payload;
};
