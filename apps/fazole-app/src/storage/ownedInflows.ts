import { TransactionId } from "@linky-fit/domain";
import type { KeyValueStorage } from "@linky-fit/linksync/evolu";
import { Option, Schema } from "effect";

const OWNED_INFLOWS_KEY = "linky.fazole.ownedInflows";
// Far more inflows than an open pledge waits for: newer ones would have repaid it.
const KEPT_INFLOWS = 1_000;

const InflowIds = Schema.fromJsonString(Schema.Array(Schema.String));

/** The ids of the payments this device created, oldest first; device-local, never synced. */
export const readOwnedInflows = (
  kv: KeyValueStorage,
): readonly TransactionId[] =>
  Schema.decodeUnknownOption(InflowIds)(kv.getItem(OWNED_INFLOWS_KEY)).pipe(
    Option.map((ids) => ids.filter(TransactionId.is)),
    Option.getOrElse(() => []),
  );

export const addOwnedInflow = (
  kv: KeyValueStorage,
  id: TransactionId,
): void => {
  const ids = readOwnedInflows(kv);
  if (ids.includes(id)) return;
  kv.setItem(
    OWNED_INFLOWS_KEY,
    Schema.encodeSync(InflowIds)([...ids, id].slice(-KEPT_INFLOWS)),
  );
};
