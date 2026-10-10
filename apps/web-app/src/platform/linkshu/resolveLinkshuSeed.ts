import { bip39MnemonicToSeed } from "@linky-fit/identity";
import { Bip39Seed } from "@linky-fit/linkshu";
import { generateMnemonic, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { Effect } from "effect";
import type { SessionSecrets } from "../session";
import {
  readStoredCashuMnemonic,
  writeStoredCashuMnemonic,
} from "../identitySecrets";

const validMnemonic = (mnemonic: string | null): string | null => {
  const trimmed = (mnemonic ?? "").trim();
  return trimmed && validateMnemonic(trimmed, wordlist) ? trimmed : null;
};

const seedOf = async (mnemonic: string): Promise<Bip39Seed> =>
  Bip39Seed.make(await Effect.runPromise(bip39MnemonicToSeed(mnemonic)));

/**
 * The wallet seed: the session's cashu BIP-85 mnemonic, else its app
 * mnemonic. An invalid cashu mnemonic deliberately does not fall through to
 * the app mnemonic (the legacy order). With neither — an nsec-only login — a
 * fresh 24-word mnemonic is generated and persisted through the
 * cashu-mnemonic write path, which wipes stale seed-bound state before
 * replacing a different mnemonic.
 */
export const resolveLinkshuSeed = async ({
  cashuMnemonic,
  appMnemonic,
}: Pick<
  SessionSecrets,
  "cashuMnemonic" | "appMnemonic"
>): Promise<Bip39Seed> => {
  const sessionMnemonic = cashuMnemonic?.trim() ? cashuMnemonic : appMnemonic;
  const valid = validMnemonic(sessionMnemonic);
  if (valid) return seedOf(valid);

  // A mnemonic saved after the session was read (another tab, an earlier
  // resolution) is the wallet's; generating another would wipe its state.
  const saved = validMnemonic(await readStoredCashuMnemonic());
  if (saved) return seedOf(saved);

  const generated = generateMnemonic(wordlist, 256);
  await writeStoredCashuMnemonic(generated);
  // Another tab can win a concurrent write; whatever storage holds now is the wallet's seed.
  return seedOf(validMnemonic(await readStoredCashuMnemonic()) ?? generated);
};
