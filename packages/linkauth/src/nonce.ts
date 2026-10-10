import { toBase64Url } from "./encoding.js";

const NONCE_PATTERN = /^[A-Za-z0-9_-]{22,128}$/;

/** A fresh login nonce: 32 random bytes, URL-safe. Store it server-side and consume it once. */
export const createNonce = (): string =>
  toBase64Url(crypto.getRandomValues(new Uint8Array(32)));

/** Whether `value` is a URL-safe string of at least 16 bytes of base64url (22 characters). */
export const isNonce = (value: string): boolean => NONCE_PATTERN.test(value);
