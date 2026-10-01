import { NonEmptyString100, NonEmptyString1000 } from "@evolu/common";
import { Effect, Option, Schema } from "effect";
import type { ShardDbError } from "../core";
import { settingIdFor } from "../model/ids";
import {
  LinkySettings,
  type SettingKey,
  type SettingValues,
} from "../model/settings";
import type { LinkyStore } from "../model/store";
import { tableRepository } from "./tableRepository";

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

/** Small synced values in the app owner, one row per `LinkySettings` key. */
export const makeSettingsRepository = (
  store: LinkyStore,
): SettingsRepository => {
  const table = tableRepository(store, "meta", "setting");
  return {
    get: (key) =>
      Effect.map(table.byId(settingIdFor(key)), (row) =>
        row?.value == null
          ? null
          : Option.getOrNull(
              Schema.decodeUnknownOption(LinkySettings[key])(row.value),
            ),
      ),
    set: (key, value) =>
      Effect.flatMap(table.byId(settingIdFor(key)), (existing) => {
        const column = NonEmptyString1000.orThrow(
          Schema.encodeSync(LinkySettings[key])(value),
        );
        return existing === null
          ? table.insert({
              id: settingIdFor(key),
              key: NonEmptyString100.orThrow(key),
              value: column,
            })
          : table
              .update(settingIdFor(key), { value: column })
              .pipe(Effect.catchTag("RowNotFound", () => Effect.void));
      }),
    remove: (key) =>
      table
        .remove(settingIdFor(key))
        .pipe(Effect.catchTag("RowNotFound", () => Effect.void)),
    subscribe: table.subscribe,
  };
};
