import { INITIAL_MNEMONIC_STORAGE_KEY } from "../mnemonic";
import {
  CASHU_BIP85_MNEMONIC_STORAGE_KEY,
  NOSTR_IDENTITY_SOURCE_STORAGE_KEY,
  NOSTR_IDENTITY_SWITCHED_AT_SEC_STORAGE_KEY,
  NOSTR_NSEC_STORAGE_KEY,
  NOSTR_SLIP39_SEED_STORAGE_KEY,
} from "../utils/constants";
import {
  clearStoredPushNsec,
  setStoredPushNsec,
} from "../utils/pushNsecStorage";
import { wipeLinkshuSeedBoundState } from "./linkshu/wipeLinkshuSeedBoundState";
import {
  readStoredSecret,
  removeStoredSecret,
  writeStoredSecret,
} from "./secretStorage";
import { safeLocalStorageRemove, safeLocalStorageSet } from "../utils/storage";

const PUSH_SECRET_MIRROR_TIMEOUT_MS = 1_500;

const mirrorPushNsecBestEffort = async (nsec: string): Promise<void> => {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
  try {
    await Promise.race([
      setStoredPushNsec(nsec).catch(() => undefined),
      new Promise<void>((resolve) => {
        timeoutId = globalThis.setTimeout(
          resolve,
          PUSH_SECRET_MIRROR_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeoutId !== null) globalThis.clearTimeout(timeoutId);
  }
};

// Deterministic counters, restore cursors, and counter leases are bound to
// whichever cashu BIP-85 mnemonic was active when they were written. When the
// mnemonic itself changes (re-onboarding, paste-nsec then derive back,
// restore-from-different SLIP-39, ...) they describe positions the new seed
// cannot reproduce, so they must go before the new mnemonic's runtime reads
// them. Wiping is also correct when no prior mnemonic is readable: any
// surviving keys then belong to a seed that is already gone.
const wipeCashuStateIfMnemonicChanged = async (
  nextCashuMnemonic: string,
): Promise<void> => {
  const next = nextCashuMnemonic.trim();
  if (!next) return;
  const current = (
    await readStoredSecret(CASHU_BIP85_MNEMONIC_STORAGE_KEY)
  )?.trim();
  if (current === next) return; // unchanged
  await wipeLinkshuSeedBoundState(next);
};

interface PersistIdentitySecretsParams {
  appMnemonic: string;
  cashuMnemonic: string;
  identitySource: "custom" | "derived";
  nsec: string;
  slip39Seed: string;
  switchedAtSec: number | null;
}

interface PersistSyncedActiveNostrIdentityParams {
  identitySource: "custom" | "derived";
  nsec: string;
  switchedAtSec: number | null;
}

export const readStoredNostrNsec = async (): Promise<string | null> => {
  return readStoredSecret(NOSTR_NSEC_STORAGE_KEY);
};

export const readStoredSlip39Seed = async (): Promise<string | null> => {
  return readStoredSecret(NOSTR_SLIP39_SEED_STORAGE_KEY);
};

export const readStoredCashuMnemonic = async (): Promise<string | null> => {
  return readStoredSecret(CASHU_BIP85_MNEMONIC_STORAGE_KEY);
};

export const writeStoredCashuMnemonic = async (
  cashuMnemonic: string,
): Promise<void> => {
  await wipeCashuStateIfMnemonicChanged(cashuMnemonic);
  await writeStoredSecret(CASHU_BIP85_MNEMONIC_STORAGE_KEY, cashuMnemonic);
};

const persistNostrIdentitySourceMarkers = (
  identitySource: PersistIdentitySecretsParams["identitySource"],
  switchedAtSec: PersistIdentitySecretsParams["switchedAtSec"],
): void => {
  safeLocalStorageSet(NOSTR_IDENTITY_SOURCE_STORAGE_KEY, identitySource);
  if (switchedAtSec && switchedAtSec > 0) {
    safeLocalStorageSet(
      NOSTR_IDENTITY_SWITCHED_AT_SEC_STORAGE_KEY,
      String(switchedAtSec),
    );
  } else {
    safeLocalStorageRemove(NOSTR_IDENTITY_SWITCHED_AT_SEC_STORAGE_KEY);
  }
};

export const persistIdentitySecrets = async ({
  appMnemonic,
  cashuMnemonic,
  identitySource,
  nsec,
  slip39Seed,
  switchedAtSec,
}: PersistIdentitySecretsParams): Promise<void> => {
  await wipeCashuStateIfMnemonicChanged(cashuMnemonic);

  await Promise.all([
    writeStoredSecret(NOSTR_NSEC_STORAGE_KEY, nsec),
    writeStoredSecret(NOSTR_SLIP39_SEED_STORAGE_KEY, slip39Seed),
    writeStoredSecret(CASHU_BIP85_MNEMONIC_STORAGE_KEY, cashuMnemonic),
    writeStoredSecret(INITIAL_MNEMONIC_STORAGE_KEY, appMnemonic),
  ]);

  persistNostrIdentitySourceMarkers(identitySource, switchedAtSec);

  // The push-service mirror is auxiliary. IndexedDB can remain blocked by a
  // suspended tab or service worker, so it must never hold account restore on
  // the loading screen after the primary identity secrets are already saved.
  await mirrorPushNsecBestEffort(nsec);
};

export const persistSyncedActiveNostrIdentity = async ({
  identitySource,
  nsec,
  switchedAtSec,
}: PersistSyncedActiveNostrIdentityParams): Promise<void> => {
  await writeStoredSecret(NOSTR_NSEC_STORAGE_KEY, nsec);

  persistNostrIdentitySourceMarkers(identitySource, switchedAtSec);

  await mirrorPushNsecBestEffort(nsec);
};

export const clearIdentitySecrets = async (): Promise<void> => {
  // The seed-bound wallet state belongs to the seed that's being cleared. If
  // the user logs in again with a different seed they'd otherwise inherit
  // stale offsets that break NUT-09 restore. When the mnemonic is already
  // unreadable the wipe-on-write in wipeCashuStateIfMnemonicChanged covers
  // the next login instead.
  const currentCashuMnemonic = (
    await readStoredSecret(CASHU_BIP85_MNEMONIC_STORAGE_KEY)
  )?.trim();
  if (currentCashuMnemonic) {
    await wipeLinkshuSeedBoundState(currentCashuMnemonic);
  }

  await Promise.all([
    removeStoredSecret(NOSTR_NSEC_STORAGE_KEY),
    removeStoredSecret(NOSTR_SLIP39_SEED_STORAGE_KEY),
    removeStoredSecret(CASHU_BIP85_MNEMONIC_STORAGE_KEY),
    removeStoredSecret(INITIAL_MNEMONIC_STORAGE_KEY),
  ]);

  safeLocalStorageRemove(NOSTR_IDENTITY_SOURCE_STORAGE_KEY);
  safeLocalStorageRemove(NOSTR_IDENTITY_SWITCHED_AT_SEC_STORAGE_KEY);

  await clearStoredPushNsec();
};
