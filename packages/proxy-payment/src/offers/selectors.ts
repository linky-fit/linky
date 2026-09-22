import type { BankOfferStatus } from "@linky/linkstr";
import {
  bankPaymentOfferBankPaidAtSec,
  bankPaymentOfferExpiresAtSec,
  bankPaymentOfferResponseDurationSec,
  isBankPaymentOfferExpired,
  offerUpdatedAtSec,
  type BankPaymentOffer,
} from "./offer";
import {
  isTerminalBankPaymentOfferStatus,
  isWholeOfferTerminalStatus,
} from "./status";

const groupByOfferId = (
  offers: readonly BankPaymentOffer[],
): Map<string, BankPaymentOffer[]> => {
  const groups = new Map<string, BankPaymentOffer[]>();
  for (const offer of offers) {
    const group = groups.get(offer.offerId) ?? [];
    group.push(offer);
    groups.set(offer.offerId, group);
  }
  return groups;
};

const byUpdatedAt = (left: BankPaymentOffer, right: BankPaymentOffer) =>
  offerUpdatedAtSec(left) - offerUpdatedAtSec(right);

const ownOffers = (offers: readonly BankPaymentOffer[], me: string) =>
  offers.filter((offer) => offer.offererPublicKey === me);

export interface ActiveBankPaymentOffers {
  nextExpiryAtSec: number | null;
  /** Peers with a live, non-terminal thread of an offer that has not ended. */
  peers: ReadonlySet<string>;
}

export const activeBankPaymentOffers = (
  offers: readonly BankPaymentOffer[],
  nowSec: number,
): ActiveBankPaymentOffers => {
  const peers = new Set<string>();
  let nextExpiryAtSec: number | null = null;

  for (const group of groupByOfferId(offers).values()) {
    if (group.some((offer) => isWholeOfferTerminalStatus(offer.status))) {
      continue;
    }
    for (const offer of group) {
      if (isTerminalBankPaymentOfferStatus(offer.status)) continue;
      const expiresAtSec = bankPaymentOfferExpiresAtSec(
        offer,
        offer.createdAtSec,
      );
      if (expiresAtSec !== null) {
        if (nowSec >= expiresAtSec) continue;
        nextExpiryAtSec =
          nextExpiryAtSec === null
            ? expiresAtSec
            : Math.min(nextExpiryAtSec, expiresAtSec);
      }
      peers.add(offer.peer);
    }
  }
  return { nextExpiryAtSec, peers };
};

export const isBankPaymentOfferCanceled = (
  offers: readonly BankPaymentOffer[],
  offerId: string,
): boolean =>
  offers.some(
    (offer) => offer.offerId === offerId && offer.status === "canceled",
  );

/** What the offerer's auto-responder owes one of its offers right now. */
export interface BankPaymentOfferResponderStep {
  /** The earliest acceptance still waiting for bank details; null once a winner exists. */
  candidate: BankPaymentOffer | null;
  ended: boolean;
  /** Recipients still offered or accepted who must learn someone else won. */
  losers: readonly BankPaymentOffer[];
  offerId: string;
  /** The recipient who already received bank details. */
  winner: BankPaymentOffer | null;
}

export const bankPaymentOfferResponderSteps = (
  offers: readonly BankPaymentOffer[],
  me: string,
): BankPaymentOfferResponderStep[] =>
  Array.from(groupByOfferId(ownOffers(offers, me)), ([offerId, group]) => {
    if (group.some((offer) => isWholeOfferTerminalStatus(offer.status))) {
      return {
        candidate: null,
        ended: true,
        losers: [],
        offerId,
        winner: null,
      };
    }
    const winner =
      group
        .filter(
          (offer) =>
            offer.status === "bank_details_sent" ||
            offer.status === "bank_paid",
        )
        .sort(byUpdatedAt)[0] ?? null;
    const candidate = winner
      ? null
      : (group
          .filter((offer) => offer.status === "accepted")
          .sort(
            (left, right) =>
              byUpdatedAt(left, right) || left.peer.localeCompare(right.peer),
          )[0] ?? null);
    const chosen = winner ?? candidate;
    const losers = chosen
      ? group.filter(
          (offer) =>
            offer.peer !== chosen.peer &&
            (offer.status === "offered" || offer.status === "accepted"),
        )
      : [];
    return { candidate, ended: false, losers, offerId, winner };
  });

/** True while one of my offers has a live acceptance without bank details. */
export const hasPendingBankPaymentOfferResponderWork = (
  offers: readonly BankPaymentOffer[],
  me: string,
  nowSec: number,
): boolean =>
  Array.from(groupByOfferId(ownOffers(offers, me)).values()).some(
    (group) =>
      !group.some((offer) => isWholeOfferTerminalStatus(offer.status)) &&
      group.some(
        (offer) =>
          offer.status === "accepted" &&
          !isBankPaymentOfferExpired(offer, offer.createdAtSec, nowSec),
      ),
  );

export interface BankPaymentOfferExpiryGroup {
  expiresAtSec: number;
  offers: readonly BankPaymentOffer[];
}

const EXPIRY_STATUS_PRIORITY: readonly BankOfferStatus[] = [
  "bank_paid",
  "bank_details_sent",
  "accepted",
  "offered",
];

/** My offers' threads grouped by offer with the deadline of their most advanced phase. */
export const ownBankPaymentOfferExpiries = (
  offers: readonly BankPaymentOffer[],
  me: string,
  nowSec: number,
): BankPaymentOfferExpiryGroup[] => {
  const live = ownOffers(offers, me).filter(
    (offer) => !isTerminalBankPaymentOfferStatus(offer.status),
  );
  return Array.from(groupByOfferId(live).values()).flatMap((group) => {
    const activeStatus = EXPIRY_STATUS_PRIORITY.find((status) =>
      group.some((offer) => offer.status === status),
    );
    if (!activeStatus) return [];
    const expiresAtSec = Math.max(
      ...group
        .filter((offer) => offer.status === activeStatus)
        .map(
          (offer) =>
            bankPaymentOfferExpiresAtSec(offer, offer.createdAtSec) ?? nowSec,
        ),
    );
    return [{ expiresAtSec, offers: group }];
  });
};

export interface BankPaymentOfferGroupResponse {
  offer: BankPaymentOffer;
  withPush: boolean;
}

export interface BankPaymentOfferGroupResponses {
  /** At least one thread already carries the status. */
  alreadyDone: boolean;
  targets: readonly BankPaymentOfferGroupResponse[];
}

const cancellationPushRank = (status: BankOfferStatus): number =>
  status === "bank_paid" ? 0 : status === "bank_details_sent" ? 1 : 2;

/** Every thread of the offer that still needs a whole-offer status; a
 * cancellation pushes only the most advanced recipient. */
export const bankPaymentOfferGroupResponses = (
  offers: readonly BankPaymentOffer[],
  offerId: string,
  nextStatus: "canceled" | "settled",
): BankPaymentOfferGroupResponses => {
  const group = offers.filter((offer) => offer.offerId === offerId);
  const pushTarget =
    nextStatus === "canceled"
      ? (group
          .filter(
            (offer) =>
              offer.status === "accepted" ||
              offer.status === "bank_details_sent" ||
              offer.status === "bank_paid",
          )
          .sort(
            (left, right) =>
              cancellationPushRank(left.status) -
                cancellationPushRank(right.status) || byUpdatedAt(left, right),
          )[0] ?? null)
      : null;
  return {
    alreadyDone: group.some((offer) => offer.status === nextStatus),
    targets: group
      .filter(
        (offer) =>
          offer.status !== nextStatus &&
          !(nextStatus === "canceled" && offer.status === "settled"),
      )
      .map((offer) => ({ offer, withPush: offer === pushTarget })),
  };
};

/** Seconds each peer needed to pay my most recent offer they completed. */
export const lastBankPaymentOfferResponseSecByPeer = (
  offers: readonly BankPaymentOffer[],
  me: string,
): ReadonlyMap<string, number> => {
  const latest = new Map<
    string,
    { bankPaidAtSec: number; durationSec: number }
  >();
  for (const offer of ownOffers(offers, me)) {
    const bankPaidAtSec = bankPaymentOfferBankPaidAtSec(offer);
    const durationSec = bankPaymentOfferResponseDurationSec(
      offer,
      offer.createdAtSec,
    );
    if (bankPaidAtSec === null || durationSec === null) continue;
    const current = latest.get(offer.peer);
    if (!current || bankPaidAtSec > current.bankPaidAtSec) {
      latest.set(offer.peer, { bankPaidAtSec, durationSec });
    }
  }
  return new Map(
    Array.from(latest, ([peer, value]) => [peer, value.durationSec]),
  );
};
