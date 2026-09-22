import {
  BankOfferId,
  BankOfferReceipt,
  BankOfferSnapshotReceived,
  ClientId,
  OwnBankOfferSnapshotConfirmed,
  RumorId,
  UnixSeconds,
  WrapDelivery,
  WrapId,
  type BankOfferDraft,
  type BankOfferInboxEvent,
  type BankOfferStatus,
} from "@linky/linkstr";
import { makeIdentity } from "@linky/linkstr/testing";
import { bankOfferContentFromSnapshot } from "../offers/content";

export const me = makeIdentity().pubkey;
export const payer = makeIdentity().pubkey;
export const other = makeIdentity().pubkey;
export const START = UnixSeconds.make(1_800_000_000);

let sequence = 0;
export const nextRumorId = (): RumorId =>
  RumorId.make((++sequence).toString(16).padStart(64, "0"));

type SnapshotFields = ConstructorParameters<
  typeof BankOfferSnapshotReceived
>[0];

/** A snapshot of `offer-1` offered by `me`; `self` marks my own echoed copy. */
export const snapshot = (
  status: BankOfferStatus,
  self: boolean,
  overrides: Partial<SnapshotFields> = {},
): BankOfferInboxEvent => {
  const fields = {
    snapshotId: nextRumorId(),
    offerId: BankOfferId.make("offer-1"),
    offerer: me,
    status,
    amountText: "500 CZK",
    text: "offer",
    amountSat: 1000,
    initiatedAtSec: START,
    bankPaidAtSec: null,
    expiresAtSec: null,
    extensionSec: null,
    spdPayload: null,
    statusUpdatedAtSec: START,
    clientId: null,
    sentAt: START,
    ...overrides,
  };
  return self
    ? new OwnBankOfferSnapshotConfirmed({
        ...fields,
        to: overrides.from ?? payer,
      })
    : new BankOfferSnapshotReceived({
        ...fields,
        from: overrides.from ?? payer,
      });
};

const delivery = (wrapId: string) =>
  new WrapDelivery({
    acceptedBy: [],
    rejectedBy: [],
    wrapId: WrapId.make(wrapId),
  });

/** The receipt linkstr would return for a sent draft. */
export const receiptFor = (
  draft: BankOfferDraft,
  sentAt: UnixSeconds = START,
): BankOfferReceipt =>
  new BankOfferReceipt({
    clientId: draft.clientId ?? ClientId.make("client"),
    content: bankOfferContentFromSnapshot({
      amountSat: draft.amountSat ?? null,
      amountText: draft.amountText,
      bankPaidAtSec:
        draft.bankPaidAtSec ?? (draft.status === "bank_paid" ? sentAt : null),
      expiresAtSec: draft.expiresAtSec ?? null,
      extensionSec: draft.extensionSec ?? null,
      initiatedAtSec:
        draft.initiatedAtSec ?? (draft.status === "offered" ? sentAt : null),
      offerId: draft.offerId,
      offerer: draft.offerer,
      spdPayload: draft.spdPayload ?? null,
      status: draft.status,
      statusUpdatedAtSec: sentAt,
      text: draft.text,
    }),
    offerId: draft.offerId,
    recipientCopy: delivery("11".repeat(32)),
    rumorId: nextRumorId(),
    selfCopy: delivery("33".repeat(32)),
    sentAt,
    status: draft.status,
  });
