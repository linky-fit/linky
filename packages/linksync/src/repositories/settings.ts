import { createIdFromString } from "@linky-fit/domain";
import { Effect, Option, Schema } from "effect";
import { ShardDbError } from "../core";
import { settingIdFor, type SettingId } from "../model/ids";
import type { LinkyDbSchema } from "../model/schema";
import {
  LinkySettings,
  type SettingKey,
  type SettingValues,
} from "../model/settings";
import type { LinkyStore } from "../model/store";
import {
  domainTableRepository,
  type DomainTableRepository,
} from "./domainRepository";

export interface SettingsRepository {
  readonly get: <K extends SettingKey>(
    key: K,
  ) => Effect.Effect<SettingValues[K] | null>;
  readonly set: <K extends SettingKey>(
    key: K,
    value: SettingValues[K],
  ) => Effect.Effect<void, ShardDbError>;
  readonly remove: (key: SettingKey) => Effect.Effect<void, ShardDbError>;
  /** Reads a setting outside `LinkySettings` (e.g. another app sharing the account), or `null` when absent. */
  readonly getRaw: (key: string) => Effect.Effect<string | null>;
  /** Writes a setting outside `LinkySettings`; key must be 1–100 chars and value 1–1000 chars. */
  readonly setRaw: (
    key: string,
    value: string,
  ) => Effect.Effect<void, ShardDbError>;
  /** Removes a setting outside `LinkySettings`; a no-op when absent. */
  readonly removeRaw: (key: string) => Effect.Effect<void, ShardDbError>;
  readonly subscribe: (listener: () => void) => () => void;
}

type SettingTable = DomainTableRepository<LinkyDbSchema["setting"]>;

const rawSettingIdFor = (key: string): SettingId =>
  createIdFromString<"Setting">(`setting/${key}`);

/** The decoded value of a setting row, or `null` when it is absent or unreadable. */
export const readSetting = <A, I extends string>(
  table: SettingTable,
  id: SettingId,
  schema: Schema.Codec<A, I>,
): Effect.Effect<A | null> =>
  Effect.map(table.byId(id), (row) =>
    row?.value == null
      ? null
      : Option.getOrNull(Schema.decodeUnknownOption(schema)(row.value)),
  );

const writeRawSetting = (
  table: SettingTable,
  id: SettingId,
  key: string,
  value: string,
): Effect.Effect<void, ShardDbError> => table.insert({ id, key, value });

export const writeSetting = <A, I extends string>(
  table: SettingTable,
  id: SettingId,
  key: string,
  schema: Schema.Codec<A, I>,
  value: A,
): Effect.Effect<void, ShardDbError> =>
  Effect.flatMap(
    Effect.try({
      try: () => Schema.encodeSync(schema)(value),
      catch: (error) =>
        new ShardDbError({
          table: "setting",
          message: `invalid ${key}: ${error instanceof Error ? error.message : String(error)}`,
        }),
    }),
    (encoded) => writeRawSetting(table, id, key, encoded),
  );

/** Small synced values in the app owner, one row per setting key. */
export const makeSettingsRepository = (
  store: LinkyStore,
): SettingsRepository => {
  const table = domainTableRepository(store, "meta", "setting");
  return {
    get: (key) => readSetting(table, settingIdFor(key), LinkySettings[key]),
    set: (key, value) =>
      writeSetting(table, settingIdFor(key), key, LinkySettings[key], value),
    remove: (key) =>
      table
        .remove(settingIdFor(key))
        .pipe(Effect.catchTag("RowNotFound", () => Effect.void)),
    getRaw: (key) =>
      Effect.map(table.byId(rawSettingIdFor(key)), (row) => row?.value ?? null),
    setRaw: (key, value) =>
      writeRawSetting(table, rawSettingIdFor(key), key, value),
    removeRaw: (key) =>
      table
        .remove(rawSettingIdFor(key))
        .pipe(Effect.catchTag("RowNotFound", () => Effect.void)),
    subscribe: table.subscribe,
  };
};
