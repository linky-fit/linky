import type { BankOfferInboxEvent, BankOfferReceipt } from "@linky/linkstr";
import {
  bankOfferContentFromSnapshot,
  decodeBankPaymentOffer,
} from "./content";
import {
  bankPaymentOffersOf,
  findBankPaymentOffer,
  isBankPaymentOfferExpired,
  offerUpdatedAtSec,
  type BankPaymentOffer,
} from "./offer";
import {
  bankPaymentOfferStatusRank,
  isOffererBankPaymentOfferStatus,
  isTerminalBankPaymentOfferStatus,
  isWholeOfferTerminalStatus,
} from "./status";

export interface BankPaymentOfferState {
  offers: readonly BankPaymentOffer[];
  /** Payer snapshots that arrived before their offerer's snapshot, oldest first. */
  pending: readonly BankOfferInboxEvent[];
}

export const emptyBankPaymentOfferState: BankPaymentOfferState = {
  offers: [],
  pending: [],
};

export interface AppliedBankPaymentOfferSnapshot {
  event: BankOfferInboxEvent;
  offer: BankPaymentOffer;
}

export interface BankPaymentOfferSnapshotResult {
  accepted: readonly AppliedBankPaymentOfferSnapshot[];
  state: BankPaymentOfferState;
}

const MAX_PENDING_SNAPSHOTS = 256;

export const bankPaymentOfferSnapshotPeer = (
  event: BankOfferInboxEvent,
): string =>
  event._tag === "BankOfferSnapshotReceived" ? event.from : event.to;

const upsertOffer = (
  offers: readonly BankPaymentOffer[],
  offer: BankPaymentOffer,
): BankPaymentOffer[] => [
  ...offers.filter(
    (existing) =>
      existing.peer !== offer.peer || existing.offerId !== offer.offerId,
  ),
  offer,
];

const withPending = (
  state: BankPaymentOfferState,
  event: BankOfferInboxEvent,
): BankPaymentOfferState => ({
  ...state,
  pending: [
    ...state.pending.filter(
      (pending) => pending.snapshotId !== event.snapshotId,
    ),
    event,
  ].slice(-MAX_PENDING_SNAPSHOTS),
});

const isStaleFor = (
  known: BankPaymentOffer,
  event: Pick<BankOfferInboxEvent, "sentAt" | "status">,
  isOfferer: boolean,
): boolean => {
  if (
    isOfferer &&
    event.status === "accepted_by_other" &&
    known.status === "accepted"
  ) {
    return false;
  }
  const knownUpdatedAt = offerUpdatedAtSec(known);
  return (
    event.sentAt < knownUpdatedAt ||
    (event.sentAt === knownUpdatedAt &&
      bankPaymentOfferStatusRank(event.status) <
        bankPaymentOfferStatusRank(known.status)) ||
    (isWholeOfferTerminalStatus(known.status) &&
      event.status !== known.status) ||
    (!isOfferer &&
      event.status !== "bank_paid" &&
      known.status !== "offered" &&
      known.status !== event.status)
  );
};

/**
 * Authorizes and merges one authenticated snapshot. Offerer snapshots
 * establish the terms; payer snapshots only advance a known offer and cannot
 * change its expiry, extension or bank details. Payer snapshots that arrive
 * before their offerer's wait in `pending` and are replayed once it lands.
 */
export const applyBankPaymentOfferSnapshot = (
  state: BankPaymentOfferState,
  event: BankOfferInboxEvent,
  me: string,
  nowSec: number,
): BankPaymentOfferSnapshotResult => {
  const unchanged = { accepted: [], state };
  const peer = bankPaymentOfferSnapshotPeer(event);
  const author = event._tag === "BankOfferSnapshotReceived" ? event.from : me;
  const isOfferer = author === event.offerer;
  if (
    isOfferer !== isOffererBankPaymentOfferStatus(event.status) ||
    (event.offerer !== peer && event.offerer !== me)
  ) {
    return unchanged;
  }

  const sameOffer = bankPaymentOffersOf(state.offers, event.offerId);
  if (sameOffer.some((offer) => offer.offererPublicKey !== event.offerer)) {
    return unchanged;
  }
  const known = findBankPaymentOffer(state.offers, peer, event.offerId);
  if (
    known &&
    (known.amountSat !== event.amountSat ||
      known.amountText !== event.amountText ||
      known.initiatedAtSec !== event.initiatedAtSec)
  ) {
    return unchanged;
  }
  if (
    !isOfferer &&
    (!known ||
      (event.status === "bank_paid" &&
        known.status !== "bank_details_sent" &&
        known.status !== "bank_paid"))
  ) {
    return { accepted: [], state: withPending(state, event) };
  }
  if (known && isStaleFor(known, event, isOfferer)) return unchanged;

  const content = bankOfferContentFromSnapshot({
    ...event,
    statusUpdatedAtSec: event.sentAt,
    ...(isOfferer || !known
      ? {}
      : {
          bankPaidAtSec: event.status === "bank_paid" ? event.sentAt : null,
          expiresAtSec: known.expiresAtSec,
          extensionSec: known.extensionSec,
          spdPayload: known.spdPayload,
        }),
  });
  const info = decodeBankPaymentOffer(content);
  if (!info?.offererPublicKey) return unchanged;
  // Whole-offer statuses only: one recipient's declined thread must not
  // swallow another recipient's later acceptance of the offer.
  if (
    !isTerminalBankPaymentOfferStatus(info.status) &&
    (sameOffer.some((offer) => isWholeOfferTerminalStatus(offer.status)) ||
      isBankPaymentOfferExpired(info, event.sentAt, nowSec))
  ) {
    return unchanged;
  }

  const offer: BankPaymentOffer = {
    ...info,
    clientId: event.clientId,
    content,
    createdAtSec: known
      ? Math.min(known.createdAtSec, event.sentAt)
      : event.sentAt,
    offererPublicKey: info.offererPublicKey,
    peer,
    snapshotId: event.snapshotId,
  };
  let next: BankPaymentOfferState = {
    offers: upsertOffer(state.offers, offer),
    pending: state.pending.filter(
      (pending) => pending.snapshotId !== event.snapshotId,
    ),
  };
  const accepted: AppliedBankPaymentOfferSnapshot[] = [{ event, offer }];
  if (!isOfferer) return { accepted, state: next };

  const waiting = next.pending
    .filter(
      (pending) =>
        pending.offerId === event.offerId &&
        bankPaymentOfferSnapshotPeer(pending) === peer,
    )
    .sort((left, right) => left.sentAt - right.sentAt);
  for (const pending of waiting) {
    next = {
      ...next,
      pending: next.pending.filter((candidate) => candidate !== pending),
    };
    const replayed = applyBankPaymentOfferSnapshot(next, pending, me, nowSec);
    next = replayed.state;
    accepted.push(...replayed.accepted);
  }
  return { accepted, state: next };
};

/** Records a snapshot this device just published; the wire content is trusted as sent. */
export const applyBankPaymentOfferReceipt = (
  state: BankPaymentOfferState,
  peer: string,
  receipt: BankOfferReceipt,
): { offer: BankPaymentOffer | null; state: BankPaymentOfferState } => {
  const info = decodeBankPaymentOffer(receipt.content);
  if (!info?.offererPublicKey) return { offer: null, state };

  const known = findBankPaymentOffer(state.offers, peer, info.offerId);
  if (
    known &&
    isStaleFor(known, receipt, isOffererBankPaymentOfferStatus(info.status))
  ) {
    return { offer: known, state };
  }
  const offer: BankPaymentOffer = {
    ...info,
    clientId: receipt.clientId,
    content: receipt.content,
    createdAtSec: known
      ? Math.min(known.createdAtSec, receipt.sentAt)
      : receipt.sentAt,
    offererPublicKey: info.offererPublicKey,
    peer,
    snapshotId: receipt.rumorId,
  };
  return {
    offer,
    state: { ...state, offers: upsertOffer(state.offers, offer) },
  };
};
