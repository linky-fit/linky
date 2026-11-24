import type { DeviceId } from "@linky-fit/domain";
import { sqliteTrue } from "@evolu/common";
import { Effect } from "effect";
import type { RowNotFound, ShardDbError } from "../core";
import type { LinkyDbSchema } from "../model/schema";
import type { LinkyStore } from "../model/store";
import { domainTableRepository, type DomainRow } from "./domainRepository";

/** The apps that write a device row; a row may name one this release does not know. */
export const deviceApps = ["linky", "fazole", "finito"] as const;
export type DeviceApp = (typeof deviceApps)[number];

type LinkedDeviceRow = DomainRow<LinkyDbSchema["linkedDevice"]>;

/** A device row whose app and name have arrived. */
export type LinkedDeviceRecord = LinkedDeviceRow & {
  readonly app: string;
  readonly name: string;
};

/** What a device says about itself on every start. */
export interface DeviceRegistration {
  readonly id: DeviceId;
  readonly app: DeviceApp;
  /** Written only while the row has no name, so a rename on another device stays. */
  readonly name: string;
  readonly deviceType: string | null;
  readonly browserName: string | null;
  readonly osName: string | null;
  /**
   * True until this device has registered since it got the recovery seed. A
   * joining device revives its row, so a removal from before it joined cannot
   * sign it out; a device that has joined never does, so a removal wins.
   */
  readonly joining: boolean;
}

export interface DevicesRepository {
  /** Every live device of the recovery seed, in every app; a row still arriving is skipped. */
  readonly all: Effect.Effect<ReadonlyArray<LinkedDeviceRecord>>;
  /**
   * Writes this device's row, or answers `removed` when another device removed
   * it after it joined: the caller then signs this device out.
   */
  readonly register: (
    device: DeviceRegistration,
  ) => Effect.Effect<"registered" | "removed", ShardDbError>;
  /**
   * `null` while the device is in the list or after it left; once another
   * device removed it, that device, or `null` for `by` when it is unknown here.
   */
  readonly removal: (
    id: DeviceId,
  ) => Effect.Effect<{ readonly by: LinkedDeviceRecord | null } | null>;
  readonly rename: (
    id: DeviceId,
    name: string,
  ) => Effect.Effect<void, ShardDbError | RowNotFound>;
  /** Signs the device out once it sees the tombstone, which names the device `by` that removed it, when known. */
  readonly remove: (
    id: DeviceId,
    by: DeviceId | null,
  ) => Effect.Effect<void, ShardDbError | RowNotFound>;
  /** Takes this device off the list on a logout, which wipes it without the removal's sign-out. */
  readonly leave: (
    id: DeviceId,
  ) => Effect.Effect<void, ShardDbError | RowNotFound>;
  readonly subscribe: (listener: () => void) => () => void;
}

const isComplete = (row: LinkedDeviceRow): row is LinkedDeviceRecord =>
  row.app !== null && row.name !== null;

/** The devices holding the recovery seed, in a fixed shard that is never forgotten. */
export const makeDevicesRepository = (store: LinkyStore): DevicesRepository => {
  const table = domainTableRepository(store, "devices", "linkedDevice");
  const newestCopy = (id: DeviceId) =>
    Effect.map(
      store.copiesOf("devices", "linkedDevice", id),
      ([newest]) => newest ?? null,
    );

  const remove = (id: DeviceId, by: DeviceId | null) =>
    Effect.andThen(
      store.remove(
        "devices",
        "linkedDevice",
        id,
        by === null ? {} : { removedBy: by },
      ),
      table.maybeRotate,
    );

  return {
    all: Effect.map(table.all, (rows) => rows.filter(isComplete)),
    register: ({ joining, name, ...device }) =>
      Effect.gen(function* () {
        const columns = {
          ...device,
          deviceType: device.deviceType ?? undefined,
          browserName: device.browserName ?? undefined,
          osName: device.osName ?? undefined,
        };
        const existing = yield* newestCopy(device.id);
        const removed = existing?.isDeleted === sqliteTrue;
        if (removed && !joining) return "removed" as const;
        if (joining) {
          // A removal of this id still in flight from before it joined loses to this write.
          yield* table.insert({ ...columns, name: existing?.name ?? name });
          return "registered" as const;
        }
        if (existing === null) {
          // Does not revive, so a removal syncing in later still wins.
          yield* table.insertIfAbsent({ ...columns, name });
          return "registered" as const;
        }
        const unchanged =
          existing.name !== null &&
          existing.app === device.app &&
          existing.deviceType === device.deviceType &&
          existing.browserName === device.browserName &&
          existing.osName === device.osName;
        // The scope never rotates, so a start that changes nothing writes nothing.
        if (unchanged) return "registered" as const;
        const { id, ...labels } = device;
        yield* table
          .update(id, {
            ...labels,
            ...(existing.name === null ? { name } : {}),
          })
          .pipe(Effect.catchTag("RowNotFound", () => Effect.void));
        return "registered" as const;
      }),
    removal: (id) =>
      Effect.gen(function* () {
        const existing = yield* newestCopy(id);
        if (existing?.isDeleted !== sqliteTrue || existing.removedBy === id)
          return null;
        const by =
          existing.removedBy === null
            ? null
            : yield* table.byId(existing.removedBy);
        return { by: by !== null && isComplete(by) ? by : null };
      }),
    rename: (id, name) => table.update(id, { name }),
    remove,
    leave: (id) => remove(id, id),
    subscribe: table.subscribe,
  };
};
