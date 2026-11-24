import {
  createId,
  DeviceId,
  type DeviceId as DeviceIdType,
} from "@linky-fit/linksync";
import { Option, Schema } from "effect";
import { safeLocalStorageGet, safeLocalStorageSet } from "../../utils/storage";

/** Logout wipes local storage, so a device signing in again is a new one. */
const THIS_DEVICE_STORAGE_KEY = "linky.thisDevice.v1";

const StoredDevice = Schema.fromJsonString(
  Schema.Struct({ id: Schema.String, joined: Schema.Boolean }),
);
const decodeStoredDevice = Schema.decodeUnknownOption(StoredDevice);
const encodeStoredDevice = Schema.encodeSync(StoredDevice);

export interface ThisDevice {
  readonly id: DeviceIdType;
  /** Whether it has registered since it got the recovery seed. */
  readonly joined: boolean;
}

/** This device's id in the devices list, created on first use. */
export const readThisDevice = (): ThisDevice => {
  const stored = Option.getOrNull(
    decodeStoredDevice(safeLocalStorageGet(THIS_DEVICE_STORAGE_KEY)),
  );
  if (stored !== null && DeviceId.is(stored.id))
    return { id: stored.id, joined: stored.joined };
  const created = { id: createId<"Device">(), joined: false };
  safeLocalStorageSet(THIS_DEVICE_STORAGE_KEY, encodeStoredDevice(created));
  return created;
};

export const markThisDeviceJoined = (id: DeviceIdType): void =>
  safeLocalStorageSet(
    THIS_DEVICE_STORAGE_KEY,
    encodeStoredDevice({ id, joined: true }),
  );
