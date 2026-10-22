import { createIdFromString } from "@linky-fit/domain";
import { Pubkey } from "@linky-fit/linkstr";
import {
  NonEmptyString100,
  NonEmptyString1000,
  type ShardDbError,
} from "@linky-fit/linksync";
import { ClientVersion } from "@linky-fit/onchain-transfer";
import { Effect, Option, Schema } from "effect";
import { DEFAULT_OPERATOR_NAME, type OperatorProfile } from "../domain/profile";
import type { SettingsRepository } from "./repositories";

const PROFILE_KEY = "onchain-operator.profile";
// The description, the watchers and the picture get rows of their own, so each can take a whole column.
const DESCRIPTION_KEY = "onchain-operator.description";
const WATCHERS_KEY = "onchain-operator.watchers";
const PICTURE_KEY = "onchain-operator.picture";
// Mirrors linksync's `settingIdFor`, whose keys are Linky's own settings only.
const settingId = (key: string) =>
  createIdFromString<"Setting">(`setting/${key}`);
const profileId = settingId(PROFILE_KEY);
const descriptionId = settingId(DESCRIPTION_KEY);
const watchersId = settingId(WATCHERS_KEY);
const pictureId = settingId(PICTURE_KEY);

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
    feeBasisPoints: Schema.Int.check(
      Schema.isBetween({ minimum: 0, maximum: 10_000 }),
    ),
    paused: Schema.Boolean,
    amounts: Schema.NonEmptyArray(Schema.Int.check(Schema.isGreaterThan(0))),
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
      settings.byId(profileId),
      settings.byId(descriptionId),
      settings.byId(watchersId),
      settings.byId(pictureId),
    ]),
    ([profile, description, watchers, picture]) =>
      Option.getOrNull(
        Option.map(
          Schema.decodeUnknownOption(ProfileJson)(profile?.value),
          (stored) => ({
            ...stored,
            name: stored.name ?? DEFAULT_OPERATOR_NAME,
            minClientVersion: stored.minClientVersion ?? null,
            description: description?.value ?? "",
            watchers: Option.getOrElse(
              Schema.decodeUnknownOption(WatchersJson)(watchers?.value),
              () => [],
            ),
            picture: Option.getOrNull(
              Schema.decodeUnknownOption(ProfilePicture)(picture?.value),
            ),
          }),
        ),
      ),
  );

/** Writes `value` to the setting row `id`, or removes the row for an empty value. */
const saveOptional = (
  settings: SettingsRepository,
  id: typeof descriptionId,
  key: string,
  value: string,
): Effect.Effect<void, ShardDbError> =>
  value === ""
    ? settings
        .remove(id)
        .pipe(Effect.catchTag("RowNotFound", () => Effect.void))
    : settings.insert({
        id,
        key: NonEmptyString100.orThrow(key),
        value: NonEmptyString1000.orThrow(value),
      });

export const saveProfile = (
  settings: SettingsRepository,
  profile: OperatorProfile,
): Effect.Effect<void, ShardDbError> =>
  Effect.all(
    [
      settings.insert({
        id: profileId,
        key: NonEmptyString100.orThrow(PROFILE_KEY),
        value: NonEmptyString1000.orThrow(
          Schema.encodeSync(ProfileJson)({
            name: profile.name,
            xpub: profile.xpub,
            feeBasisPoints: profile.feeBasisPoints,
            paused: profile.paused,
            amounts: profile.amounts,
            ...(profile.minClientVersion === null
              ? {}
              : { minClientVersion: profile.minClientVersion }),
          }),
        ),
      }),
      saveOptional(
        settings,
        descriptionId,
        DESCRIPTION_KEY,
        profile.description,
      ),
      saveOptional(
        settings,
        watchersId,
        WATCHERS_KEY,
        profile.watchers.length === 0
          ? ""
          : Schema.encodeSync(WatchersJson)(profile.watchers),
      ),
      saveOptional(settings, pictureId, PICTURE_KEY, profile.picture ?? ""),
    ],
    { discard: true },
  );
