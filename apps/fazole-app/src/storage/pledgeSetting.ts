import { createIdFromString } from "@linky-fit/domain";
import { Pubkey } from "@linky-fit/linkstr";
import {
  NonEmptyString100,
  NonEmptyString1000,
  type ShardDbError,
} from "@linky-fit/linksync";
import { Effect, Option, Schema } from "effect";
import { CzkAmount, type Pledge } from "../domain";
import type { SettingsRepository } from "./shop";

const PLEDGE_KEY = "fazole.pledge";
// Mirrors linksync's `settingIdFor`, whose keys are Linky's own settings only.
export const pledgeSettingId = createIdFromString<"Setting">(
  `setting/${PLEDGE_KEY}`,
);

/** The open pledge, or `{}` once it closed: the row stays, as settings are never removed. */
const PledgeJson = Schema.fromJsonString(
  Schema.Struct({
    pubkey: Schema.optionalKey(Pubkey),
    address: Schema.optionalKey(Schema.String),
    amountCzk: Schema.optionalKey(CzkAmount),
    createdAtSec: Schema.optionalKey(Schema.Int),
  }),
);

/** The open pledge; `null` while the merchant owes nobody. */
export const readPledge = (
  settings: SettingsRepository,
): Effect.Effect<Pledge | null> =>
  Effect.map(settings.byId(pledgeSettingId), (row) =>
    Option.getOrNull(
      Option.flatMap(
        Schema.decodeUnknownOption(PledgeJson)(row?.value),
        ({ pubkey, address, amountCzk, createdAtSec }) =>
          pubkey === undefined ||
          amountCzk === undefined ||
          createdAtSec === undefined
            ? Option.none()
            : Option.some<Pledge>({
                pubkey,
                address: address ?? null,
                amountCzk,
                createdAtSec,
              }),
      ),
    ),
  );

/** Opens the pledge, or closes it on `null`. */
export const savePledge = (
  settings: SettingsRepository,
  pledge: Pledge | null,
): Effect.Effect<void, ShardDbError> =>
  settings.insert({
    id: pledgeSettingId,
    key: NonEmptyString100.orThrow(PLEDGE_KEY),
    value: NonEmptyString1000.orThrow(
      Schema.encodeSync(PledgeJson)(
        pledge === null
          ? {}
          : {
              pubkey: pledge.pubkey,
              ...(pledge.address === null ? {} : { address: pledge.address }),
              amountCzk: pledge.amountCzk,
              createdAtSec: pledge.createdAtSec,
            },
      ),
    ),
  });
