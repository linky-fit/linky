import type { KeyValueStorage } from "@linky-fit/linksync/evolu";
import { Option, Schema } from "effect";

const RECORDED_INFLOWS_KEY = "linky.fazole.recordedInflows";
// Far more inflows than an open pledge waits for: newer ones would have repaid it.
const KEPT_INFLOWS = 1_000;

const InflowIds = Schema.fromJsonString(Schema.Array(Schema.String));

/** The ids of the inflows this device recorded, oldest first; device-local, never synced. */
export const readRecordedInflows = (kv: KeyValueStorage): readonly string[] =>
  Option.getOrElse(
    Schema.decodeUnknownOption(InflowIds)(kv.getItem(RECORDED_INFLOWS_KEY)),
    () => [],
  );

export const addRecordedInflow = (kv: KeyValueStorage, id: string): void => {
  const ids = readRecordedInflows(kv);
  if (ids.includes(id)) return;
  kv.setItem(
    RECORDED_INFLOWS_KEY,
    Schema.encodeSync(InflowIds)([...ids, id].slice(-KEPT_INFLOWS)),
  );
};
