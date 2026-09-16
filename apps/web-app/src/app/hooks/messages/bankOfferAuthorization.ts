import {
  BankOfferSnapshotReceived,
  UnixSeconds,
  OwnBankOfferSnapshotConfirmed,
  type BankOfferInboxEvent,
} from "@linky/linkstr";
import {
  getLinkyBankPaymentOfferInfo,
  getLinkyBankPaymentOfferStatusRank,
  isLinkyBankPaymentOfferWholeOfferTerminalStatus,
} from "../../lib/bankPaymentOffer";
import type { LocalNostrMessage } from "../../types/appTypes";
import { bankOfferContentFromSnapshot } from "./inboxNotifications";

type OfferInfo = NonNullable<ReturnType<typeof getLinkyBankPaymentOfferInfo>>;

interface AuthorizedOffer {
  info: OfferInfo;
  updatedAt: number;
}

const MAX_PENDING_SNAPSHOTS = 256;

/** Authenticated offerer snapshots establish terms; payer snapshots only advance them. */
export class BankOfferAuthorization {
  private readonly offers = new Map<string, AuthorizedOffer>();
  private readonly pending = new Map<string, BankOfferInboxEvent>();

  receive(
    event: BankOfferInboxEvent,
    myPubkey: string,
    contactId: string,
    messages: readonly LocalNostrMessage[],
  ): BankOfferInboxEvent[] {
    const peer =
      event._tag === "BankOfferSnapshotReceived" ? event.from : event.to;
    const author =
      event._tag === "BankOfferSnapshotReceived" ? event.from : myPubkey;
    const key = `${peer}:${event.offerId}`;
    const isOfferer = author === event.offerer;
    const offererStatus =
      event.status === "offered" ||
      event.status === "bank_details_sent" ||
      event.status === "accepted_by_other" ||
      event.status === "canceled" ||
      event.status === "settled";
    if (
      isOfferer !== offererStatus ||
      (event.offerer !== peer && event.offerer !== myPubkey)
    )
      return [];

    const stored = messages.flatMap((message) => {
      const info = getLinkyBankPaymentOfferInfo(message.content);
      return info?.offerId === event.offerId ? [{ message, info }] : [];
    });
    if (
      stored.some(({ info }) => info.offererPublicKey !== event.offerer) ||
      [...this.offers.values()].some(
        ({ info }) =>
          info.offerId === event.offerId &&
          info.offererPublicKey !== event.offerer,
      )
    )
      return [];

    let known = this.offers.get(key);
    const local = stored.find(({ message }) => message.contactId === contactId);
    if (local) {
      const updatedAt =
        local.info.statusUpdatedAtSec ?? local.message.createdAtSec;
      if (
        !known ||
        updatedAt > known.updatedAt ||
        (updatedAt === known.updatedAt &&
          getLinkyBankPaymentOfferStatusRank(local.info.status) >
            getLinkyBankPaymentOfferStatusRank(known.info.status))
      ) {
        known = { info: local.info, updatedAt };
        this.offers.set(key, known);
      }
    }
    if (
      known &&
      (known.info.offererPublicKey !== event.offerer ||
        known.info.amountSat !== event.amountSat ||
        known.info.amountText !== event.amountText ||
        known.info.initiatedAtSec !== event.initiatedAtSec)
    )
      return [];

    if (
      !isOfferer &&
      (!known ||
        (event.status === "bank_paid" &&
          known.info.status !== "bank_details_sent" &&
          known.info.status !== "bank_paid"))
    ) {
      this.pending.set(event.snapshotId, event);
      if (this.pending.size > MAX_PENDING_SNAPSHOTS) {
        const oldest = this.pending.keys().next().value;
        if (oldest !== undefined) this.pending.delete(oldest);
      }
      return [];
    }
    if (
      known &&
      (event.sentAt < known.updatedAt ||
        (event.sentAt === known.updatedAt &&
          getLinkyBankPaymentOfferStatusRank(event.status) <
            getLinkyBankPaymentOfferStatusRank(known.info.status)) ||
        (isLinkyBankPaymentOfferWholeOfferTerminalStatus(known.info.status) &&
          event.status !== known.info.status) ||
        (!isOfferer &&
          event.status !== "bank_paid" &&
          known.info.status !== "offered" &&
          known.info.status !== event.status))
    )
      return [];

    const fields = {
      ...event,
      statusUpdatedAtSec: event.sentAt,
      ...(isOfferer || !known
        ? {}
        : {
            expiresAtSec:
              known.info.expiresAtSec === null
                ? null
                : UnixSeconds.make(known.info.expiresAtSec),
            extensionSec: known.info.extensionSec,
            spdPayload: known.info.spdPayload,
            bankPaidAtSec: event.status === "bank_paid" ? event.sentAt : null,
          }),
    };
    const accepted =
      event._tag === "BankOfferSnapshotReceived"
        ? new BankOfferSnapshotReceived({ ...fields, from: event.from })
        : new OwnBankOfferSnapshotConfirmed({ ...fields, to: event.to });
    const info = getLinkyBankPaymentOfferInfo(
      bankOfferContentFromSnapshot(accepted),
    );
    if (!info) return [];
    this.offers.set(key, { info, updatedAt: event.sentAt });
    this.pending.delete(event.snapshotId);
    const result: BankOfferInboxEvent[] = [accepted];
    if (isOfferer) {
      const waiting = [...this.pending.values()]
        .filter(
          (pending) =>
            pending.offerId === event.offerId &&
            (pending._tag === "BankOfferSnapshotReceived"
              ? pending.from
              : pending.to) === peer,
        )
        .sort((a, b) => a.sentAt - b.sentAt);
      for (const pending of waiting) {
        this.pending.delete(pending.snapshotId);
        result.push(...this.receive(pending, myPubkey, contactId, []));
      }
    }
    return result;
  }
}
