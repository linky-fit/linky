import { createEvoluDeps, createRun } from "@evolu/web";
import type { AtomRegistry } from "effect/reactivity";
import { makeAppRegistry } from "../app/registry";
import { openSessionEvolu } from "../app/state/session/evolu";
import type { PlatformPorts, SecretRead } from "../platform/ports";
import type {
  SessionSecrets,
  SessionState,
  SignedInSession,
} from "../platform/session";
import { localStorageKv } from "../utils/storage";

export const testPlatformPorts = (
  overrides: Partial<PlatformPorts> = {},
): PlatformPorts => ({
  kv: localStorageKv,
  secrets: {
    read: (): Promise<SecretRead> => Promise.resolve({ _tag: "Missing" }),
  },
  config: { evoluRelayDefaults: [], isE2e: false, isDev: false },
  lifecycle: {
    reload: () => {},
    deferUpdateWhile: () => {},
    isOnline: () =>
      typeof navigator === "undefined" || navigator.onLine !== false,
  },
  ...overrides,
});

/** Ports over a key-value store whose items the test can inspect. */
export const memoryKvPorts = (initial: Record<string, string> = {}) => {
  const items = new Map(Object.entries(initial));
  const ports = testPlatformPorts({
    kv: {
      getItem: (key) => items.get(key) ?? null,
      setItem: (key, value) => void items.set(key, value),
      removeItem: (key) => void items.delete(key),
    },
  });
  return { items, ports };
};

export const signedInSession = (
  secrets: Partial<SessionSecrets> = {},
): SignedInSession => ({
  _tag: "SignedIn",
  secrets: {
    nsec: "nsec1test",
    appMnemonic: null,
    cashuMnemonic: null,
    slip39Seed: null,
    ...secrets,
  },
  degraded: false,
});

export const makeTestAppRegistry = ({
  ports = testPlatformPorts(),
  session = signedInSession(),
}: {
  readonly ports?: PlatformPorts;
  readonly session?: SessionState;
} = {}) => makeAppRegistry({ ports, session });

/**
 * Opens the session's database the way main.tsx does; the test mocks
 * `openLinkyEvolu` and `openLinkyStore`, and runs in jsdom, which Evolu's web
 * deps need.
 */
export const openTestEvolu = (registry: AtomRegistry.AtomRegistry) =>
  openSessionEvolu(registry, createRun(createEvoluDeps()), {
    memoryOnly: false,
  });
