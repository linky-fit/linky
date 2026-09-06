import { Bip39Seed } from "@linky/linkshu";
import {
  generateMnemonic,
  mnemonicToSeedSync,
  validateMnemonic,
} from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { INITIAL_MNEMONIC_STORAGE_KEY } from "../../mnemonic";
import { CASHU_BIP85_MNEMONIC_STORAGE_KEY } from "../../utils/constants";
import { safeLocalStorageGet } from "../../utils/storage";
import { writeStoredCashuMnemonic } from "../identitySecrets";

let cachedSeed: { mnemonic: string; bip39seed: Uint8Array } | null = null;

/**
 * The legacy cashu read order: the stored cashu BIP-85 mnemonic, else the
 * initial app mnemonic — an invalid stored cashu mnemonic deliberately does
 * not fall through. The derived seed is cached per mnemonic because
 * `mnemonicToSeedSync` is PBKDF2 work.
 */
const readStoredSeed = (): Uint8Array | null => {
  const cashuMnemonic = (
    safeLocalStorageGet(CASHU_BIP85_MNEMONIC_STORAGE_KEY) ?? ""
  ).trim();
  const fallbackMnemonic = (
    safeLocalStorageGet(INITIAL_MNEMONIC_STORAGE_KEY) ?? ""
  ).trim();

  const mnemonic = cashuMnemonic || fallbackMnemonic;
  if (!mnemonic || !validateMnemonic(mnemonic, wordlist)) {
    cachedSeed = null;
    return null;
  }
  if (cachedSeed?.mnemonic !== mnemonic) {
    cachedSeed = { mnemonic, bip39seed: mnemonicToSeedSync(mnemonic) };
  }
  return cachedSeed.bip39seed;
};

/**
 * Resolves the wallet seed exactly as the legacy cashu code did. When
 * neither stored mnemonic is valid — an nsec-only login — a fresh 24-word
 * mnemonic is generated and persisted through the cashu-mnemonic write path,
 * which wipes stale seed-bound state before replacing a different mnemonic.
 */
export const resolveLinkshuSeed = async (): Promise<Bip39Seed> => {
  const existing = readStoredSeed();
  if (existing) return Bip39Seed.make(existing);

  const generated = generateMnemonic(wordlist, 256);
  await writeStoredCashuMnemonic(generated);
  // Storage can be unavailable or another tab can win a concurrent write;
  // whatever the legacy read path sees now is the wallet's seed.
  return Bip39Seed.make(readStoredSeed() ?? mnemonicToSeedSync(generated));
};
