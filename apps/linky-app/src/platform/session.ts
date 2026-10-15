import { reportAppLog } from "../devtools/inspector/appLog";
import { INITIAL_MNEMONIC_STORAGE_KEY } from "../mnemonic";
import {
  CASHU_BIP85_MNEMONIC_STORAGE_KEY,
  NOSTR_NSEC_STORAGE_KEY,
  NOSTR_SLIP39_SEED_STORAGE_KEY,
} from "../utils/constants";
import {
  clearStoredPushNsec,
  setStoredPushNsec,
} from "../utils/pushNsecStorage";
import { asNonEmptyString } from "../utils/validation";
import type { PlatformPorts, SecretRead, SecretsPort } from "./ports";

export interface SessionSecrets {
  readonly nsec: string;
  readonly appMnemonic: string | null;
  readonly cashuMnemonic: string | null;
  readonly slip39Seed: string | null;
}

export type SessionState =
  | { readonly _tag: "SignedOut" }
  | {
      readonly _tag: "SignedIn";
      readonly secrets: SessionSecrets;
      readonly degraded: false;
    }
  | {
      readonly _tag: "SignedIn";
      readonly secrets: SessionSecrets;
      readonly degraded: true;
      readonly cause: string;
      /** Failed in the secure store with no localStorage copy: unknown, not missing. */
      readonly unreadable: ReadonlySet<keyof SessionSecrets>;
    }
  // The secure store failed and the fallback holds no nsec; renders as signed out for now.
  | { readonly _tag: "SecretsUnavailable"; readonly cause: string };

export type SignedInSession = Extract<
  SessionState,
  { readonly _tag: "SignedIn" }
>;

const SECRET_KEYS = {
  nsec: NOSTR_NSEC_STORAGE_KEY,
  appMnemonic: INITIAL_MNEMONIC_STORAGE_KEY,
  cashuMnemonic: CASHU_BIP85_MNEMONIC_STORAGE_KEY,
  slip39Seed: NOSTR_SLIP39_SEED_STORAGE_KEY,
} as const;

// Boot waits for the session, so a hung native bridge must not hold it longer.
const SECRET_READ_TIMEOUT_MS = 5_000;

const readWithTimeout = async (
  secrets: SecretsPort,
  key: string,
): Promise<SecretRead> => {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
  try {
    return await Promise.race([
      secrets.read(key),
      new Promise<SecretRead>((resolve) => {
        timeoutId = globalThis.setTimeout(
          () => resolve({ _tag: "Unavailable", cause: "timed out" }),
          SECRET_READ_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeoutId !== null) globalThis.clearTimeout(timeoutId);
  }
};

interface KeyRead {
  readonly name: keyof SessionSecrets;
  readonly key: string;
  readonly value: string | null;
  /** Why the secure store could not answer; the value then comes from the fallback. */
  readonly failure: string | null;
}

const readKey = async (
  { secrets, kv }: PlatformPorts,
  name: keyof SessionSecrets,
): Promise<KeyRead> => {
  const key = SECRET_KEYS[name];
  const read = await readWithTimeout(secrets, key);
  if (read._tag === "Found")
    return { name, key, value: read.value, failure: null };
  return {
    name,
    key,
    value: asNonEmptyString(kv.getItem(key)),
    failure: read._tag === "Unavailable" ? read.cause : null,
  };
};

const describeFailures = (reads: ReadonlyArray<KeyRead>): string =>
  reads.map(({ key, failure }) => `${key}: ${failure}`).join("; ");

/**
 * The identity secrets this page load runs on: the secure store first, the
 * localStorage copy when it has nothing or fails.
 */
export const loadSession = async (
  ports: PlatformPorts,
): Promise<SessionState> => {
  const [nsec, appMnemonic, cashuMnemonic, slip39Seed] = await Promise.all([
    readKey(ports, "nsec"),
    readKey(ports, "appMnemonic"),
    readKey(ports, "cashuMnemonic"),
    readKey(ports, "slip39Seed"),
  ]);
  const failed = [nsec, appMnemonic, cashuMnemonic, slip39Seed].filter(
    (read) => read.failure !== null,
  );
  const keys = failed.map((read) => read.key);
  if (nsec.value === null) {
    if (nsec.failure === null) return { _tag: "SignedOut" };
    reportAppLog({
      tag: "session.secretsUnavailable",
      summary: "Secure storage failed and holds no fallback identity",
      payload: { keys },
    });
    return { _tag: "SecretsUnavailable", cause: describeFailures(failed) };
  }
  const secrets: SessionSecrets = {
    nsec: nsec.value,
    appMnemonic: appMnemonic.value,
    cashuMnemonic: cashuMnemonic.value,
    slip39Seed: slip39Seed.value,
  };
  if (failed.length === 0)
    return { _tag: "SignedIn", secrets, degraded: false };
  const unreadable = failed.filter((read) => read.value === null);
  reportAppLog({
    tag: "session.secretsDegraded",
    summary: `Secure storage failed for ${failed.length} secrets; using their localStorage copies`,
    payload: { keys, unreadable: unreadable.map((read) => read.key) },
  });
  return {
    _tag: "SignedIn",
    secrets,
    degraded: true,
    cause: describeFailures(failed),
    unreadable: new Set(unreadable.map((read) => read.name)),
  };
};

/** Keeps the push service's copy of the nsec in step with the session; best effort. */
export const mirrorPushNsec = (session: SessionState): void => {
  if (session._tag === "SecretsUnavailable") return;
  void (async () => {
    try {
      if (session._tag === "SignedIn")
        await setStoredPushNsec(session.secrets.nsec);
      else await clearStoredPushNsec();
    } catch {
      // The mirror is auxiliary; the next boot retries.
    }
  })();
};
