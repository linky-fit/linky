import type { KeyValueStorage } from "@linky-fit/linksync/evolu";
import { Option, Schema } from "effect";

const OWNED_INFLOWS_KEY = "linky.fazole.ownedInflows";
// Far more inflows than an open pledge waits for: newer ones would have repaid it.
const KEPT_INFLOWS = 1_000;

const InflowIds = Schema.fromJsonString(Schema.Array(Schema.String));

/** The ids of the payments this device created and the inflows it recorded, oldest first; device-local, never synced. */
export const readOwnedInflows = (kv: KeyValueStorage): readonly string[] =>
  Option.getOrElse(
    Schema.decodeUnknownOption(InflowIds)(kv.getItem(OWNED_INFLOWS_KEY)),
    () => [],
  );

export const addOwnedInflow = (kv: KeyValueStorage, id: string): void => {
  const ids = readOwnedInflows(kv);
  if (ids.includes(id)) return;
  kv.setItem(
    OWNED_INFLOWS_KEY,
    Schema.encodeSync(InflowIds)([...ids, id].slice(-KEPT_INFLOWS)),
  );
};
