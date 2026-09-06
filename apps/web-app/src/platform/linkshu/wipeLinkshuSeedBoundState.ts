import { Bip39Seed, Restore, runLinkshu } from "@linky/linkshu";
import { mnemonicToSeedSync } from "@scure/bip39";
import { Effect } from "effect";
import { migrateLegacyCashuLocalState } from "../../app/migrations/linkshuStorageMigration";
import { linkshuAppInspector } from "../../devtools/inspector/linkshuInspector";
import { localStorageKeyValueStore } from "./localStorageKeyValueStore";

/**
 * Runs linkshu `Restore.wipeSeedBoundState` over the app's KeyValueStore:
 * every deterministic counter, restore cursor, and counter lease is removed,
 * because those describe positions in a derivation tree only one seed can
 * reproduce. Must run whenever the cashu mnemonic is replaced or cleared;
 * linkshu owns which keys are seed-bound. Failures are logged, not thrown —
 * identity persistence must not fail over wallet diagnostics, and when
 * storage itself is unavailable there is no stale state to outlive it.
 */
export const wipeLinkshuSeedBoundState = async (
  mnemonic: string,
): Promise<void> => {
  // Migrate first so the wipe also clears counters bound to the old seed.
  // Removal gate for this prologue is in docs/architecture.md.
  migrateLegacyCashuLocalState();
  try {
    await runLinkshu(
      {
        bip39Seed: Bip39Seed.make(mnemonicToSeedSync(mnemonic)),
        keyValueStore: localStorageKeyValueStore,
        inspector: linkshuAppInspector,
      },
      Effect.flatMap(Restore, (restore) => restore.wipeSeedBoundState),
    );
  } catch (error) {
    console.warn("[linky] linkshu seed-bound state wipe failed", error);
  }
};
