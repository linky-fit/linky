import { Effect } from "effect";
import { IdentityDerivationError } from "./slip39";

const BIP39_WORD_COUNTS = [12, 15, 18, 21, 24];

const nfkdBytes = (value: string) =>
  new TextEncoder().encode(value.normalize("NFKD"));

/**
 * BIP-39 mnemonic to 64-byte seed: PBKDF2-HMAC-SHA512, 2048 iterations, salt
 * `"mnemonic" + passphrase`, both NFKD-normalized. Like `mnemonicToSeedSync`
 * from `@scure/bip39` it checks the word count, not the checksum.
 *
 * Runs on the runtime's WebCrypto `crypto.subtle`, which the browser, Bun and
 * Node provide natively; React Native needs react-native-quick-crypto
 * installed as the global `crypto` first.
 */
export const bip39MnemonicToSeed = (
  mnemonic: string,
  passphrase = "",
): Effect.Effect<Uint8Array, IdentityDerivationError> =>
  Effect.tryPromise({
    try: async () => {
      const wordCount = mnemonic.normalize("NFKD").split(" ").length;
      if (!BIP39_WORD_COUNTS.includes(wordCount)) {
        throw new Error(`Invalid BIP-39 mnemonic word count ${wordCount}`);
      }
      const { subtle } = globalThis.crypto;
      const key = await subtle.importKey(
        "raw",
        nfkdBytes(mnemonic),
        "PBKDF2",
        false,
        ["deriveBits"],
      );
      const seed = await subtle.deriveBits(
        {
          name: "PBKDF2",
          hash: "SHA-512",
          salt: nfkdBytes(`mnemonic${passphrase}`),
          iterations: 2048,
        },
        key,
        512,
      );
      return new Uint8Array(seed);
    },
    catch: (cause) =>
      new IdentityDerivationError({
        cause,
        message: "Failed to derive the BIP-39 seed",
      }),
  });
