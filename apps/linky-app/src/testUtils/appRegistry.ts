import { createConsole, createRandomBytes, createTime } from "@evolu/common";
import { makeAppRegistry } from "../app/registry";
import type {
  EvoluPlatform,
  PlatformPorts,
  SecretRead,
} from "../platform/ports";
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
  config: {
    evoluRelayDefaults: [],
    isE2e: false,
    isDev: false,
    blockOnFirstHydration: false,
  },
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

/** Evolu's own deps over a worker that never answers; tests mock `createEvolu` on top. */
export const testEvoluPlatform: EvoluPlatform = {
  evoluDeps: {
    console: createConsole(),
    randomBytes: createRandomBytes(),
    time: createTime(),
    reloadApp: () => {},
  },
  createWorker: () => ({ postMessage: () => {}, onMessage: () => {} }),
  inMemory: true,
  enableLogging: false,
};

export const makeTestAppRegistry = ({
  ports = testPlatformPorts(),
  session = signedInSession(),
  evoluPlatform = testEvoluPlatform,
}: {
  readonly ports?: PlatformPorts;
  readonly session?: SessionState;
  readonly evoluPlatform?: EvoluPlatform | null;
} = {}) => makeAppRegistry({ ports, session, evoluPlatform });
