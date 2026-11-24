import {
  parseSlip39Share,
  recoverMasterSecretFromSlip39Share,
} from "@linky-fit/identity";
import type { PairingPayload } from "@linky-fit/linkstr";
import {
  createId,
  describeDevice,
  DeviceId,
  type DevicesRepository,
  type LinkedDeviceRecord,
} from "@linky-fit/linksync";
import type { KeyValueStorage } from "@linky-fit/linksync/evolu";
import type { LiveSource } from "@linky-fit/linksync/react";
import { bytesToHex } from "@noble/hashes/utils.js";
import { Effect, Option, Schema } from "effect";

const APP_NAMES: Readonly<Record<string, string>> = {
  linky: "Linky",
  fazole: "Fazole",
  finito: "Finito",
};

/** The app a device row names; an app this release does not know shows as written. */
export const deviceAppName = (app: string): string => APP_NAMES[app] ?? app;

/** How a removed device names the one that removed it, e.g. "MacBook (Linky)". */
const removerLabel = (device: LinkedDeviceRecord): string =>
  `${device.name} (${deviceAppName(device.app)})`;

/** The device reset wipes local storage, so a device signing in again is a new one. */
const THIS_DEVICE_KEY = "linky.fazole.thisDevice";

const StoredDevice = Schema.fromJsonString(
  Schema.Struct({ id: Schema.String, joined: Schema.Boolean }),
);
const decodeStoredDevice = Schema.decodeUnknownOption(StoredDevice);
const encodeStoredDevice = Schema.encodeSync(StoredDevice);

/** This device's id in the devices list and whether it has registered since it got the seed. */
export const readThisDevice = (
  kv: KeyValueStorage,
): { readonly id: DeviceId; readonly joined: boolean } => {
  const stored = Option.getOrNull(
    decodeStoredDevice(kv.getItem(THIS_DEVICE_KEY)),
  );
  if (stored !== null && DeviceId.is(stored.id))
    return { id: stored.id, joined: stored.joined };
  const created = { id: createId<"Device">(), joined: false };
  kv.setItem(THIS_DEVICE_KEY, encodeStoredDevice(created));
  return created;
};

/** Where this device stands in the list and what it does when removed. */
export interface DevicePorts {
  readonly kv: KeyValueStorage;
  readonly userAgent: string;
  /** Another device removed this one: sign it out, saying which device did, when known. */
  readonly onRemoved: (removedBy: string | null) => void;
  /** The sync servers a new device starts with, sent when pairing. */
  readonly syncServers: () => ReadonlyArray<string>;
}

/** The devices of the recovery seed in every app, and this device's place among them. */
export interface Devices {
  readonly thisDeviceId: DeviceId | null;
  readonly live: LiveSource<ReadonlyArray<LinkedDeviceRecord>>;
  readonly rename: (id: DeviceId, name: string) => Promise<void>;
  /** Signs the device out once it syncs the removal. */
  readonly remove: (id: DeviceId) => Promise<void>;
  /** What a new device receives when this one adds it. */
  readonly pairingPayload: (shop: {
    readonly name: string | null;
  }) => Promise<PairingPayload>;
  /** Registers this device and watches for its removal; returns the stop. */
  readonly start: () => () => void;
}

export const createDevices = ({
  repository,
  recoverySeed,
  ports,
}: {
  readonly repository: DevicesRepository;
  readonly recoverySeed: string;
  /** Without them, as in tests, this device neither registers nor signs out. */
  readonly ports: DevicePorts | undefined;
}): Devices => {
  const thisDevice = ports === undefined ? null : readThisDevice(ports.kv);
  let signedOut = false;
  const signOut = async () => {
    if (signedOut || thisDevice === null) return;
    signedOut = true;
    const removal = await Effect.runPromise(repository.removal(thisDevice.id));
    ports?.onRemoved(removal?.by == null ? null : removerLabel(removal.by));
  };

  const register = async () => {
    if (ports === undefined || thisDevice === null) return false;
    const labels = describeDevice(ports.userAgent);
    const { joined } = readThisDevice(ports.kv);
    const outcome = await Effect.runPromise(
      repository.register({
        id: thisDevice.id,
        app: "fazole",
        name: labels.name ?? "Fazole",
        deviceType: labels.deviceType,
        browserName: labels.browserName,
        osName: labels.osName,
        joining: !joined,
      }),
    );
    if (outcome === "removed") {
      await signOut();
      return false;
    }
    if (!joined)
      ports.kv.setItem(
        THIS_DEVICE_KEY,
        encodeStoredDevice({ id: thisDevice.id, joined: true }),
      );
    return true;
  };

  return {
    thisDeviceId: thisDevice?.id ?? null,
    live: { all: repository.all, subscribe: repository.subscribe },
    rename: (id, name) =>
      Effect.runPromise(repository.rename(id, name.trim().slice(0, 255))),
    remove: (id) =>
      Effect.runPromise(repository.remove(id, thisDevice?.id ?? null)),
    pairingPayload: async (shop) => {
      const secret = await Effect.runPromise(
        Effect.flatMap(parseSlip39Share(recoverySeed), (share) =>
          recoverMasterSecretFromSlip39Share(share),
        ),
      );
      return {
        masterKey: bytesToHex(secret),
        accountName: shop.name?.trim().slice(0, 255) || "Fazole",
        transports: (ports?.syncServers() ?? [])
          .filter((url) => url.startsWith("wss://"))
          .slice(0, 8),
      };
    },
    start: () => {
      let registered = false;
      void register().then((done) => {
        registered = done;
      });
      return repository.subscribe(() => {
        if (!registered || thisDevice === null) return;
        void Effect.runPromise(repository.removal(thisDevice.id)).then(
          (removal) => {
            if (removal !== null) void signOut();
          },
        );
      });
    },
  };
};
