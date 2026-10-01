import { Schema } from "effect";
import { ClientId, Pubkey, RumorId, UnixSeconds } from "../domain/primitives";
import { BankOfferId, BankOfferStatus } from "./domain";

// Offers are multi-party, so authorship and role are independent axes: the
// class split carries who authored the wrap, `offerer` carries the role.
const snapshotFields = {
  snapshotId: RumorId,
  offerId: BankOfferId,
  offerer: Pubkey,
  status: BankOfferStatus,
  amountText: Schema.String,
  text: Schema.NullOr(Schema.String),
  amountSat: Schema.NullOr(Schema.Int),
  initiatedAtSec: Schema.NullOr(UnixSeconds),
  bankPaidAtSec: Schema.NullOr(UnixSeconds),
  expiresAtSec: Schema.NullOr(UnixSeconds),
  extensionSec: Schema.NullOr(Schema.Int),
  spdPayload: Schema.NullOr(Schema.String),
  statusUpdatedAtSec: Schema.NullOr(UnixSeconds),
  clientId: Schema.NullOr(ClientId),
  sentAt: UnixSeconds,
};

export class BankOfferSnapshotReceived extends Schema.TaggedClass<BankOfferSnapshotReceived>()(
  "BankOfferSnapshotReceived",
  {
    from: Pubkey,
    ...snapshotFields,
  },
) {}

/**
 * My own snapshot observed on a relay — the echo of the self copy, or a
 * publish from another device. `to` is the counterparty whose conversation
 * the snapshot belongs to.
 */
export class OwnBankOfferSnapshotConfirmed extends Schema.TaggedClass<OwnBankOfferSnapshotConfirmed>()(
  "OwnBankOfferSnapshotConfirmed",
  {
    to: Pubkey,
    ...snapshotFields,
  },
) {}

export const BankOfferInboxEvent = Schema.Union([
  BankOfferSnapshotReceived,
  OwnBankOfferSnapshotConfirmed,
]);
export type BankOfferInboxEvent = typeof BankOfferInboxEvent.Type;
