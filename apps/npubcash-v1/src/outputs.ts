import { Amount, blindMessage, OutputData } from "@cashu/cashu-ts";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

const SECP256K1_ORDER =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

const utf8 = new TextEncoder();

const derive = (
  seed: Uint8Array,
  domain: "secret" | "blinding",
  mintUrl: string,
  quoteId: string,
  index: number,
) =>
  hmac(
    sha256,
    seed,
    utf8.encode(JSON.stringify([domain, mintUrl, quoteId, index])),
  );

/**
 * The outputs of one quote, the same on every call. The keyset id is left out
 * of the derivation (unlike NUT-13), so a keyset rotation cannot strand them:
 * mints look signatures up by `B_` alone.
 */
export function deriveOutputs(
  seed: Uint8Array,
  mintUrl: string,
  quoteId: string,
  amounts: readonly number[],
  keysetId: string,
): OutputData[] {
  return amounts.map((amount, index) => {
    const secret = utf8.encode(
      bytesToHex(derive(seed, "secret", mintUrl, quoteId, index)),
    );
    const blinding =
      BigInt(
        `0x${bytesToHex(derive(seed, "blinding", mintUrl, quoteId, index))}`,
      ) % SECP256K1_ORDER;
    const { B_, r } = blindMessage(secret, blinding);
    return new OutputData(
      { amount: Amount.from(amount), B_: B_.toHex(true), id: keysetId },
      r,
      secret,
    );
  });
}
