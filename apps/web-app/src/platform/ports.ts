import type {
  createLinkyEvolu,
  KeyValueStorage,
} from "@linky-fit/linksync/evolu";

/** Synchronous device-local storage that swallows storage failures (localStorage on the web). */
export type KeyValuePort = KeyValueStorage;

export type SecretRead =
  | { readonly _tag: "Found"; readonly value: string }
  | { readonly _tag: "Missing" }
  | { readonly _tag: "Unavailable"; readonly cause: string };

/** The device's secure storage: the native keystore in the native shells, localStorage on the web. */
export interface SecretsPort {
  readonly read: (key: string) => Promise<SecretRead>;
}

/** Build-time settings, read once at boot. */
export interface AppConfig {
  /** Evolu relays the build pins for a fresh origin. */
  readonly evoluRelayDefaults: ReadonlyArray<string>;
  readonly isE2e: boolean;
}

export interface LifecyclePort {
  readonly reload: () => void;
}

export interface PlatformPorts {
  readonly kv: KeyValuePort;
  readonly secrets: SecretsPort;
  readonly config: AppConfig;
  readonly lifecycle: LifecyclePort;
}

/** What opening the Linky database needs from the platform; see `createLinkyEvolu`. */
export type EvoluPlatform = Pick<
  Parameters<typeof createLinkyEvolu>[0],
  "evoluDeps" | "createWorker" | "inMemory" | "enableLogging"
>;
