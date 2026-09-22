import { BankOfferId, UnixSeconds } from "@linky/linkstr";
import { describe, expect, it } from "vitest";
import { me, other, payer, snapshot, START } from "../testing/offers";
import {
  activeBankPaymentOffers,
  bankPaymentOfferGroupResponses,
  bankPaymentOfferResponderSteps,
  hasPendingBankPaymentOfferResponderWork,
  lastBankPaymentOfferResponseSecByPeer,
  ownBankPaymentOfferExpiries,
} from "./selectors";
import {
  applyBankPaymentOfferSnapshot,
  emptyBankPaymentOfferState,
  type BankPaymentOfferState,
} from "./state";

const at = (offset: number) => UnixSeconds.make(START + offset);

const book = (...events: ReturnType<typeof snapshot>[]) =>
  events.reduce<BankPaymentOfferState>(
    (state, event) =>
      applyBankPaymentOfferSnapshot(state, event, me, START + 1).state,
    emptyBankPaymentOfferState,
  ).offers;

describe("activeBankPaymentOffers", () => {
  it("returns every peer currently participating in a proxy payment", () => {
    const offers = book(
      snapshot("offered", true),
      snapshot("offered", true, { from: other }),
      snapshot("declined", false, { from: other, sentAt: at(10) }),
      snapshot("offered", true, {
        offerId: BankOfferId.make("offer-2"),
        sentAt: at(20),
      }),
    );
    const active = activeBankPaymentOffers(offers, START + 30);
    expect([...active.peers]).toEqual([payer]);
    expect(active.nextExpiryAtSec).toBe(START + 300);
  });

  it("removes an expired or globally completed proxy payment", () => {
    const offered = book(snapshot("offered", true));
    expect(activeBankPaymentOffers(offered, START + 300).peers.size).toBe(0);

    const canceled = book(
      snapshot("offered", true),
      snapshot("canceled", true, { from: other, sentAt: at(50) }),
    );
    expect(activeBankPaymentOffers(canceled, START + 60).peers.size).toBe(0);
  });
});

describe("bankPaymentOfferResponderSteps", () => {
  it("picks the earliest acceptance and lists the others as losers", () => {
    const offers = book(
      snapshot("offered", true),
      snapshot("offered", true, { from: other }),
      snapshot("accepted", false, { from: other, sentAt: at(2) }),
      snapshot("accepted", false, { sentAt: at(3) }),
    );
    const [step] = bankPaymentOfferResponderSteps(offers, me);
    expect(step).toMatchObject({ ended: false, winner: null });
    expect(step?.candidate?.peer).toBe(other);
    expect(step?.losers.map((offer) => offer.peer)).toEqual([payer]);
    expect(hasPendingBankPaymentOfferResponderWork(offers, me, START + 4)).toBe(
      true,
    );
    expect(
      hasPendingBankPaymentOfferResponderWork(offers, me, START + 400),
    ).toBe(false);
  });

  it("keeps closing losers once a winner holds the bank details", () => {
    const offers = book(
      snapshot("offered", true),
      snapshot("offered", true, { from: other }),
      snapshot("accepted", false, { sentAt: at(2) }),
      snapshot("bank_details_sent", true, { sentAt: at(3) }),
    );
    const [step] = bankPaymentOfferResponderSteps(offers, me);
    expect(step?.winner?.peer).toBe(payer);
    expect(step?.candidate).toBeNull();
    expect(step?.losers.map((offer) => offer.peer)).toEqual([other]);
    expect(hasPendingBankPaymentOfferResponderWork(offers, me, START + 4)).toBe(
      false,
    );
  });

  it("marks an ended offer and ignores offers of other offerers", () => {
    const offers = book(
      snapshot("settled", true),
      snapshot("offered", false, {
        offerId: BankOfferId.make("offer-2"),
        offerer: payer,
      }),
    );
    expect(bankPaymentOfferResponderSteps(offers, me)).toEqual([
      expect.objectContaining({ ended: true, offerId: "offer-1" }),
    ]);
  });
});

describe("ownBankPaymentOfferExpiries", () => {
  it("uses the deadline of the most advanced phase across recipients", () => {
    const offers = book(
      snapshot("offered", true),
      snapshot("offered", true, { from: other }),
      snapshot("accepted", false, { sentAt: at(100) }),
    );
    expect(ownBankPaymentOfferExpiries(offers, me, START)).toEqual([
      { expiresAtSec: START + 400, offers: expect.any(Array) },
    ]);
  });
});

describe("bankPaymentOfferGroupResponses", () => {
  it("cancels every open thread and pushes only the most advanced recipient", () => {
    const offers = book(
      snapshot("offered", true),
      snapshot("offered", true, { from: other }),
      snapshot("accepted", false, { from: other, sentAt: at(2) }),
    );
    const { alreadyDone, targets } = bankPaymentOfferGroupResponses(
      offers,
      "offer-1",
      "canceled",
    );
    expect(alreadyDone).toBe(false);
    expect(
      targets.map(({ offer, withPush }) => [offer.peer, withPush]),
    ).toEqual([
      [payer, false],
      [other, true],
    ]);
  });

  it("skips threads already carrying the status and never cancels a settled one", () => {
    const offers = book(
      snapshot("settled", true),
      snapshot("accepted_by_other", true, { from: other }),
    );
    expect(
      bankPaymentOfferGroupResponses(offers, "offer-1", "canceled").targets.map(
        ({ offer }) => offer.peer,
      ),
    ).toEqual([other]);
    expect(
      bankPaymentOfferGroupResponses(offers, "offer-1", "settled"),
    ).toMatchObject({ alreadyDone: true });
  });
});

describe("lastBankPaymentOfferResponseSecByPeer", () => {
  it("finds the most recent completed response for each peer of my offers", () => {
    const paid = (
      offerId: string,
      peer: typeof payer,
      initiated: number,
      paidAt: number,
    ) => [
      snapshot("offered", true, {
        offerId: BankOfferId.make(offerId),
        from: peer,
        initiatedAtSec: at(initiated),
        sentAt: at(initiated),
      }),
      snapshot("accepted", false, {
        offerId: BankOfferId.make(offerId),
        from: peer,
        initiatedAtSec: at(initiated),
        sentAt: at(initiated + 1),
      }),
      snapshot("bank_details_sent", true, {
        offerId: BankOfferId.make(offerId),
        from: peer,
        initiatedAtSec: at(initiated),
        sentAt: at(initiated + 2),
      }),
      snapshot("bank_paid", false, {
        offerId: BankOfferId.make(offerId),
        from: peer,
        initiatedAtSec: at(initiated),
        sentAt: at(paidAt),
      }),
    ];
    const offers = book(
      ...paid("offer-a", payer, 0, 45),
      ...paid("offer-b", payer, 100, 225),
      ...paid("offer-c", other, 300, 330),
    );
    const durations = lastBankPaymentOfferResponseSecByPeer(offers, me);
    expect(durations.get(payer)).toBe(125);
    expect(durations.get(other)).toBe(30);
    expect(lastBankPaymentOfferResponseSecByPeer(offers, payer).size).toBe(0);
  });
});
