import { NonEmptyString100, NonEmptyString1000 } from "@evolu/common";
import { Effect } from "effect";
import type { ShardDbError } from "../core";
import { settingIdFor } from "@linky/domain";
import type { LinkyStore } from "../model/store";
import { tableRepository } from "./tableRepository";

export interface SettingsRepository {
  readonly get: (key: string) => Effect.Effect<string | null>;
  readonly set: (
    key: string,
    value: string,
  ) => Effect.Effect<void, ShardDbError>;
  readonly remove: (key: string) => Effect.Effect<void, ShardDbError>;
  readonly subscribe: (listener: () => void) => () => void;
}

/** Small synced flags in the app owner; replaces the ad hoc `ownerMeta` scopes. */
export const makeSettingsRepository = (
  store: LinkyStore,
): SettingsRepository => {
  const table = tableRepository(store, "meta", "setting");
  return {
    get: (key) =>
      Effect.map(table.byId(settingIdFor(key)), (row) => row?.value ?? null),
    set: (key, value) =>
      Effect.flatMap(table.byId(settingIdFor(key)), (existing) => {
        const column = NonEmptyString1000.orThrow(value);
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
