import { Pubkey } from "@linky-fit/linkstr";
import type { ShardDbError } from "@linky-fit/linksync";
import {
  ClientVersion,
  DEFAULT_MAX_RECEIVE_AMOUNT,
  DEFAULT_MIN_RECEIVE_AMOUNT,
} from "@linky-fit/onchain-transfer";
import { Effect, Option, Schema, Struct } from "effect";
import { DEFAULT_OPERATOR_NAME, type OperatorProfile } from "../domain/profile";
import type { SettingsRepository } from "./repositories";

const PROFILE_KEY = "onchain-operator.profile";
// The description, the watchers and the picture get rows of their own, so each can take a whole column.
const DESCRIPTION_KEY = "onchain-operator.description";
const WATCHERS_KEY = "onchain-operator.watchers";
const PICTURE_KEY = "onchain-operator.picture";

/** An https URL that fits its setting row. */
export const ProfilePicture = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^https:\/\/\S+$/u), Schema.isMaxLength(1000)),
);

const WatchersJson = Schema.fromJsonString(Schema.Array(Pubkey));

const ProfileJson = Schema.fromJsonString(
  Schema.Struct({
    // Absent in profiles saved before the operator had a name.
    name: Schema.optionalKey(Schema.String),
    xpub: Schema.String,
    // The on-chain send's fee, the only fee before receives had their own.
    feeBasisPoints: Schema.Int.check(
      Schema.isBetween({ minimum: 0, maximum: 10_000 }),
    ),
    receiveFeeBasisPoints: Schema.optionalKey(
      Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10_000 })),
    ),
    paused: Schema.Boolean,
    amounts: Schema.NonEmptyArray(Schema.Int.check(Schema.isGreaterThan(0))),
    // Absent in profiles saved before on-chain receives took any amount.
    maxReceiveAmount: Schema.optionalKey(
      Schema.Int.check(Schema.isGreaterThan(0)),
    ),
    // Absent in profiles saved before on-chain receives of any amount.
    minReceiveAmount: Schema.optionalKey(
      Schema.Int.check(Schema.isGreaterThan(0)),
    ),
    // Absent in profiles saved before the minimum, and while there is none.
    minClientVersion: Schema.optionalKey(ClientVersion),
  }),
);

/** The saved profile; `null` before the first save. */
export const readProfile = (
  settings: SettingsRepository,
): Effect.Effect<OperatorProfile | null> =>
  Effect.map(
    Effect.all([
      settings.getRaw(PROFILE_KEY),
      settings.getRaw(DESCRIPTION_KEY),
      settings.getRaw(WATCHERS_KEY),
      settings.getRaw(PICTURE_KEY),
    ]),
    ([profile, description, watchers, picture]) =>
      Option.getOrNull(
        Option.map(
          Schema.decodeUnknownOption(ProfileJson)(profile),
          (stored) => ({
            ...Struct.omit(stored, ["feeBasisPoints"]),
            sendFeeBasisPoints: stored.feeBasisPoints,
            receiveFeeBasisPoints:
              stored.receiveFeeBasisPoints ?? stored.feeBasisPoints,
            name: stored.name ?? DEFAULT_OPERATOR_NAME,
            maxReceiveAmount:
              stored.maxReceiveAmount ?? DEFAULT_MAX_RECEIVE_AMOUNT,
            minReceiveAmount:
              stored.minReceiveAmount ?? DEFAULT_MIN_RECEIVE_AMOUNT,
            minClientVersion: stored.minClientVersion ?? null,
            description: description ?? "",
            watchers: Option.getOrElse(
              Schema.decodeUnknownOption(WatchersJson)(watchers),
              () => [],
            ),
            picture: Option.getOrNull(
              Schema.decodeUnknownOption(ProfilePicture)(picture),
            ),
          }),
        ),
      ),
  );

/** Writes `value` to the setting row `key`, or removes the row for an empty value. */
const saveOptional = (
  settings: SettingsRepository,
  key: string,
  value: string,
): Effect.Effect<void, ShardDbError> =>
  value === "" ? settings.removeRaw(key) : settings.setRaw(key, value);

export const saveProfile = (
  settings: SettingsRepository,
  profile: OperatorProfile,
): Effect.Effect<void, ShardDbError> =>
  Effect.all(
    [
      settings.setRaw(
        PROFILE_KEY,
        Schema.encodeSync(ProfileJson)({
          name: profile.name,
          xpub: profile.xpub,
          feeBasisPoints: profile.sendFeeBasisPoints,
          receiveFeeBasisPoints: profile.receiveFeeBasisPoints,
          paused: profile.paused,
          amounts: profile.amounts,
          maxReceiveAmount: profile.maxReceiveAmount,
          minReceiveAmount: profile.minReceiveAmount,
          ...(profile.minClientVersion === null
            ? {}
            : { minClientVersion: profile.minClientVersion }),
        }),
      ),
      saveOptional(settings, DESCRIPTION_KEY, profile.description),
      saveOptional(
        settings,
        WATCHERS_KEY,
        profile.watchers.length === 0
          ? ""
          : Schema.encodeSync(WatchersJson)(profile.watchers),
      ),
      saveOptional(settings, PICTURE_KEY, profile.picture ?? ""),
    ],
    { discard: true },
  );
