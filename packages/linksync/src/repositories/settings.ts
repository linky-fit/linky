import { NonEmptyString100, NonEmptyString1000 } from "@evolu/common";
import { Effect, Option, Schema } from "effect";
import type { ShardDbError } from "../core";
import { settingIdFor, type SettingId } from "../model/ids";
import type { LinkyDbSchema } from "../model/schema";
import {
  LinkySettings,
  type SettingKey,
  type SettingValues,
} from "../model/settings";
import type { LinkyStore } from "../model/store";
import { tableRepository, type TableRepository } from "./tableRepository";

export interface SettingsRepository {
  readonly get: <K extends SettingKey>(
    key: K,
  ) => Effect.Effect<SettingValues[K] | null>;
  readonly set: <K extends SettingKey>(
    key: K,
    value: SettingValues[K],
  ) => Effect.Effect<void, ShardDbError>;
  readonly remove: (key: SettingKey) => Effect.Effect<void, ShardDbError>;
  readonly subscribe: (listener: () => void) => () => void;
}

type SettingTable = TableRepository<LinkyDbSchema["setting"]>;

/** The decoded value of a setting row, or `null` when it is absent or unreadable. */
export const readSetting = <A, I extends string>(
  table: SettingTable,
  id: SettingId,
  schema: Schema.Schema<A, I>,
): Effect.Effect<A | null> =>
  Effect.map(table.byId(id), (row) =>
    row?.value == null
      ? null
      : Option.getOrNull(Schema.decodeUnknownOption(schema)(row.value)),
  );

export const writeSetting = <A, I extends string>(
  table: SettingTable,
  id: SettingId,
  key: string,
  schema: Schema.Schema<A, I>,
  value: A,
): Effect.Effect<void, ShardDbError> =>
  Effect.flatMap(table.byId(id), (existing) => {
    const column = NonEmptyString1000.orThrow(Schema.encodeSync(schema)(value));
    return existing === null
      ? table.insert({ id, key: NonEmptyString100.orThrow(key), value: column })
      : table
          .update(id, { value: column })
          .pipe(Effect.catchTag("RowNotFound", () => Effect.void));
  });

/** Small synced values in the app owner, one row per `LinkySettings` key. */
export const makeSettingsRepository = (
  store: LinkyStore,
): SettingsRepository => {
  const table = tableRepository(store, "meta", "setting");
  return {
    get: (key) => readSetting(table, settingIdFor(key), LinkySettings[key]),
    set: (key, value) =>
      writeSetting(table, settingIdFor(key), key, LinkySettings[key], value),
    remove: (key) =>
      table
        .remove(settingIdFor(key))
        .pipe(Effect.catchTag("RowNotFound", () => Effect.void)),
    subscribe: table.subscribe,
  };
};
