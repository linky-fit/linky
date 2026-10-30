import { createIdFromString } from "@linky-fit/domain";
import {
  NonEmptyString100,
  NonEmptyString1000,
  type ShardDbError,
} from "@linky-fit/linksync";
import { Effect, Option, Schema } from "effect";
import { CzechIban } from "../domain";
import type { SettingsRepository } from "./shop";

const MONETA_KEY = "fazole.moneta";
// Mirrors linksync's `settingIdFor`, whose keys are Linky's own settings only.
export const monetaSettingId = createIdFromString<"Setting">(
  `setting/${MONETA_KEY}`,
);

/** An API token as MONETA's Internet Banka issues it: one line, short enough to fit the setting row next to the account. */
export const MonetaToken = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^\S{8,800}$/u)),
);
const isMonetaToken = Schema.is(MonetaToken);

/** The token and the bank's id of the account it reads, for the shop's IBAN at the time it was connected. */
export interface MonetaConnection {
  readonly token: string;
  readonly accountId: string;
  readonly iban: CzechIban;
}

/** The connection, or `{}` once it was removed: the row stays, as settings are never removed. */
const MonetaJson = Schema.fromJsonString(
  Schema.Struct({
    token: Schema.optionalKey(MonetaToken),
    accountId: Schema.optionalKey(Schema.String),
    iban: Schema.optionalKey(CzechIban),
  }),
);

/** The MONETA connection; `null` while the shop has none. */
export const readMonetaConnection = (
  settings: SettingsRepository,
): Effect.Effect<MonetaConnection | null> =>
  Effect.map(settings.byId(monetaSettingId), (row) =>
    Option.getOrNull(
      Option.flatMap(
        Schema.decodeUnknownOption(MonetaJson)(row?.value),
        ({ token, accountId, iban }) =>
          token === undefined || accountId === undefined || iban === undefined
            ? Option.none()
            : Option.some<MonetaConnection>({ token, accountId, iban }),
      ),
    ),
  );

/** Stores the connection, or removes it on `null`. */
export const saveMonetaConnection = (
  settings: SettingsRepository,
  connection: MonetaConnection | null,
): Effect.Effect<void, ShardDbError> =>
  settings.insert({
    id: monetaSettingId,
    key: NonEmptyString100.orThrow(MONETA_KEY),
    value: NonEmptyString1000.orThrow(
      Schema.encodeSync(MonetaJson)(
        connection === null
          ? {}
          : {
              token: connection.token,
              accountId: connection.accountId,
              iban: connection.iban,
            },
      ),
    ),
  });

/** The token as the merchant pasted it, without the surrounding whitespace; `null` unless it looks like one. */
export const parseMonetaTokenInput = (value: string): string | null => {
  const token = value.trim();
  return isMonetaToken(token) ? token : null;
};
