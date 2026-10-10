import { mnemonicToSeedWebcrypto } from "@scure/bip39";
import { Effect } from "effect";
import { IdentityDerivationError } from "./slip39";

/**
 * BIP-39 mnemonic to 64-byte seed. Checks the word count, not the checksum.
 *
 * Runs PBKDF2 on the runtime's WebCrypto `crypto.subtle`, which the browser,
 * Bun and Node provide natively; React Native needs react-native-quick-crypto
 * installed as the global `crypto` first.
 */
export const bip39MnemonicToSeed = (
  mnemonic: string,
  passphrase = "",
): Effect.Effect<Uint8Array, IdentityDerivationError> =>
  Effect.tryPromise({
    try: () => mnemonicToSeedWebcrypto(mnemonic, passphrase),
    catch: (cause) =>
      new IdentityDerivationError({
        cause,
        message: "Failed to derive the BIP-39 seed",
      }),
  });
