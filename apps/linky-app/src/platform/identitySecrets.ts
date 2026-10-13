import { INITIAL_MNEMONIC_STORAGE_KEY } from "../mnemonic";
import {
  CASHU_BIP85_MNEMONIC_STORAGE_KEY,
  NOSTR_ATTACHED_NSEC_STORAGE_KEY,
  NOSTR_IDENTITY_SOURCE_STORAGE_KEY,
  NOSTR_IDENTITY_SWITCHED_AT_SEC_STORAGE_KEY,
  NOSTR_NSEC_STORAGE_KEY,
  NOSTR_SLIP39_SEED_STORAGE_KEY,
} from "../utils/constants";
import {
  clearStoredPushNsec,
  setStoredPushNsec,
} from "../utils/pushNsecStorage";
import { forgetRecoveredMasterSecret } from "../utils/slip39Nostr";
import { reportAppLog } from "../devtools/inspector/appLog";
import { asNonEmptyString } from "../utils/validation";
import { wipeLinkshuSeedBoundState } from "./linkshu/wipeLinkshuSeedBoundState";
import { isNativePlatform } from "./runtime";
import {
  readNativeSecret,
  readStoredSecret,
  removeNativeSecret,
  removeStoredSecret,
  writeStoredSecret,
} from "./secretStorage";
import {
  localStorageKv,
  safeLocalStorageRemove,
  safeLocalStorageSet,
} from "../utils/storage";
import { writeAppMnemonicState } from "./appMnemonicState";

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

const nativeHolds = async (key: string, value: string): Promise<boolean> => {
  try {
    return (await readNativeSecret(key)) === asNonEmptyString(value);
  } catch {
    return false;
  }
};

const writeLocalSecret = (key: string, value: string): void => {
  const normalized = asNonEmptyString(value);
  if (normalized) safeLocalStorageSet(key, normalized);
  else safeLocalStorageRemove(key);
};

/**
 * Writes the secrets as one set. Boot reads the native store first, so when
 * it misses any of them the set is removed from it and boot reads the
 * complete localStorage copy instead of a mix of old and new secrets.
 */
const writeSecretSet = async (
  secrets: Readonly<Record<string, string>>,
): Promise<void> => {
  const entries = Object.entries(secrets);
  const writes = entries.map(([key, value]) => writeStoredSecret(key, value));
  if (!isNativePlatform()) {
    await Promise.all(writes);
    return;
  }
  await Promise.allSettled(writes);
  const held = await Promise.all(
    entries.map(([key, value]) => nativeHolds(key, value)),
  );
  const missed = entries.filter((_, index) => !held[index]);
  if (missed.length === 0) return;

  // A native write that throws skips its localStorage write.
  for (const [key, value] of entries) writeLocalSecret(key, value);
  const removals = await Promise.allSettled(
    entries.map(([key]) => removeNativeSecret(key)),
  );
  reportAppLog({
    tag: "secrets.nativeWriteRolledBack",
    summary: `Native secure storage missed ${missed.length} of ${entries.length} secrets; removed the set from it so boot reads localStorage`,
    payload: {
      keys: entries.map(([key]) => key),
      missed: missed.map(([key]) => key),
      notRemoved: entries
        .filter((_, index) => removals[index].status === "rejected")
        .map(([key]) => key),
    },
  });
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

export const readStoredAttachedNsec = async (): Promise<string | null> => {
  return readStoredSecret(NOSTR_ATTACHED_NSEC_STORAGE_KEY);
};

export const writeStoredAttachedNsec = async (nsec: string): Promise<void> => {
  await writeStoredSecret(NOSTR_ATTACHED_NSEC_STORAGE_KEY, nsec);
};

export const removeStoredAttachedNsec = async (): Promise<void> => {
  await removeStoredSecret(NOSTR_ATTACHED_NSEC_STORAGE_KEY);
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
  await writeSecretSet({ [CASHU_BIP85_MNEMONIC_STORAGE_KEY]: cashuMnemonic });
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

  const hasAppMnemonic = asNonEmptyString(appMnemonic) !== null;
  // Raised before the write and lowered after it, so an interrupted write never reads as absent.
  if (hasAppMnemonic) writeAppMnemonicState(localStorageKv, "present");
  await writeSecretSet({
    [NOSTR_NSEC_STORAGE_KEY]: nsec,
    [NOSTR_SLIP39_SEED_STORAGE_KEY]: slip39Seed,
    [CASHU_BIP85_MNEMONIC_STORAGE_KEY]: cashuMnemonic,
    [INITIAL_MNEMONIC_STORAGE_KEY]: appMnemonic,
  });
  if (!hasAppMnemonic) writeAppMnemonicState(localStorageKv, "absent");

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
  await writeSecretSet({ [NOSTR_NSEC_STORAGE_KEY]: nsec });

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
    removeStoredSecret(NOSTR_ATTACHED_NSEC_STORAGE_KEY),
    removeStoredSecret(NOSTR_SLIP39_SEED_STORAGE_KEY),
    removeStoredSecret(CASHU_BIP85_MNEMONIC_STORAGE_KEY),
    removeStoredSecret(INITIAL_MNEMONIC_STORAGE_KEY),
  ]);
  writeAppMnemonicState(localStorageKv, "absent");

  safeLocalStorageRemove(NOSTR_IDENTITY_SOURCE_STORAGE_KEY);
  safeLocalStorageRemove(NOSTR_IDENTITY_SWITCHED_AT_SEC_STORAGE_KEY);
  forgetRecoveredMasterSecret();

  await clearStoredPushNsec();
};
