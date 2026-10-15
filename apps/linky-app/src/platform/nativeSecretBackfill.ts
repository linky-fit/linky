import { reportAppLog } from "../devtools/inspector/appLog";
import { INITIAL_MNEMONIC_STORAGE_KEY } from "../mnemonic";
import {
  CASHU_BIP85_MNEMONIC_STORAGE_KEY,
  NOSTR_NSEC_STORAGE_KEY,
  NOSTR_SLIP39_SEED_STORAGE_KEY,
} from "../utils/constants";
import { safeLocalStorageGet } from "../utils/storage";
import { asNonEmptyString } from "../utils/validation";
import { getPlatformTarget, isNativePlatform } from "./runtime";
import { readNativeSecret, writeNativeSecret } from "./secretStorage";

const SECRET_STORAGE_KEYS = [
  NOSTR_NSEC_STORAGE_KEY,
  NOSTR_SLIP39_SEED_STORAGE_KEY,
  CASHU_BIP85_MNEMONIC_STORAGE_KEY,
  INITIAL_MNEMONIC_STORAGE_KEY,
];

type BackfillOutcome = "alreadyPresent" | "backfilled" | "failed" | "mismatch";

const backfillSecret = async (
  key: string,
  localValue: string,
): Promise<BackfillOutcome> => {
  try {
    const nativeValue = await readNativeSecret(key);
    if (nativeValue === undefined) return "failed";
    if (nativeValue !== null) {
      return nativeValue === localValue ? "alreadyPresent" : "mismatch";
    }

    await writeNativeSecret(key, localValue);
    return (await readNativeSecret(key)) === localValue
      ? "backfilled"
      : "failed";
  } catch {
    return "failed";
  }
};

const reportBackfill = (outcomes: Record<string, BackfillOutcome>): void => {
  const counts: Record<BackfillOutcome, number> = {
    alreadyPresent: 0,
    backfilled: 0,
    failed: 0,
    mismatch: 0,
  };
  for (const outcome of Object.values(outcomes)) counts[outcome] += 1;

  reportAppLog({
    tag: "secrets.nativeBackfill",
    summary: `Native secret backfill: ${counts.backfilled} backfilled, ${counts.alreadyPresent} already present, ${counts.mismatch} mismatched, ${counts.failed} failed`,
    payload: { platform: getPlatformTarget(), ...counts, outcomes },
  });
};

/**
 * Copies secrets that exist only in WebView localStorage into the native
 * secret store, leaving localStorage untouched and never overwriting a native
 * value.
 */
export const backfillNativeSecrets = async (): Promise<void> => {
  if (!isNativePlatform()) return;

  const outcomes: Record<string, BackfillOutcome> = {};
  for (const key of SECRET_STORAGE_KEYS) {
    const localValue = asNonEmptyString(safeLocalStorageGet(key));
    if (localValue) outcomes[key] = await backfillSecret(key, localValue);
  }

  if (Object.keys(outcomes).length > 0) reportBackfill(outcomes);
};
