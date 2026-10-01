import { Schema } from "effect";
import { PlainEventReceipt } from "../domain/delivery";
import { RelayUrl, UnixSeconds } from "../domain/primitives";

/** One kind-10002 "r" entry; a null marker means both read and write. */
export class RelayListEntry extends Schema.Class<RelayListEntry>(
  "RelayListEntry",
)({
  relay: RelayUrl,
  marker: Schema.NullOr(Schema.Literals(["read", "write"])),
}) {}

export class RelayListsDraft extends Schema.Class<RelayListsDraft>(
  "RelayListsDraft",
)({
  /** Kind 10002 (NIP-65 relay list). */
  relays: Schema.Array(RelayListEntry),
  /** Kind 10050 (NIP-17 DM inbox relays) — a flat relay list on the wire. */
  dmRelays: Schema.Array(RelayUrl),
}) {}

export class RelayListsReceipt extends Schema.Class<RelayListsReceipt>(
  "RelayListsReceipt",
)({
  relayList: PlainEventReceipt,
  dmRelayList: PlainEventReceipt,
}) {}

/** Null list = no event of that kind found on any read relay. */
export class FetchedRelayLists extends Schema.Class<FetchedRelayLists>(
  "FetchedRelayLists",
)({
  relays: Schema.NullOr(Schema.Array(RelayListEntry)),
  relaysUpdatedAt: Schema.NullOr(UnixSeconds),
  dmRelays: Schema.NullOr(Schema.Array(RelayUrl)),
  dmRelaysUpdatedAt: Schema.NullOr(UnixSeconds),
}) {}
