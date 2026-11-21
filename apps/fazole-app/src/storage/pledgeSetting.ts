import { Pubkey } from "@linky-fit/linkstr";
import type { ShardDbError } from "@linky-fit/linksync";
import { Effect, Option, Schema } from "effect";
import { CzkAmount, type Pledge } from "../domain";
import type { SettingsRepository } from "./shop";

const PLEDGE_KEY = "fazole.pledge";

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
  Effect.map(settings.getRaw(PLEDGE_KEY), (value) =>
    Option.getOrNull(
      Option.flatMap(
        Schema.decodeUnknownOption(PledgeJson)(value),
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
  settings.setRaw(
    PLEDGE_KEY,
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
  );
