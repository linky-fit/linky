/** Deterministic secp256k1 secret key: 31 zero bytes followed by `lastByte`. */
export const createSecretKey = (lastByte: number): Uint8Array => {
  const secretKey = new Uint8Array(32);
  secretKey[31] = lastByte;
  return secretKey;
};
